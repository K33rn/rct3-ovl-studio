"""Local web viewer: python -m rct3ovl view <game folder>. Serves a small JSON API + a three.js page."""
from __future__ import annotations

import base64
import io
import json
import os
import re
import threading
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import fireworks as fw
from . import frontscreen, mods, parks
from . import texedit as tx
from .characters import build_person, carried_items, describe_variant, variants
from .container import OvlError
from .designs import build_design, design_files, design_path
from .export import export_resource
from .gltf import shape_to_glb
from .library import Library
from .media import text
from .meshes import load_shape
from .rides import build_ride, list_rides, track_sets
from .scenery import build_scenery, list_scenery

STATIC = os.path.join(os.path.dirname(__file__), 'static')


def serve(root: str, port: int = 8765, open_browser: bool = True):
    lib = Library(root)
    lock = threading.Lock()                 # Library caches are not thread-safe

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body: bytes, ctype: str, extra: dict | None = None):
            # byte ranges for audio / video: without them the browser can't seek (music always restarted at 0:00)
            media = ctype.startswith(('audio/', 'video/'))
            m = re.match(r'bytes=(\d*)-(\d*)$', self.headers.get('Range', '').strip()) if code == 200 and media else None
            if m and (m.group(1) or m.group(2)):
                n = len(body)
                a, b = (int(m.group(1)), int(m.group(2) or n - 1)) if m.group(1) else (max(0, n - int(m.group(2))), n - 1)
                b = min(b, n - 1)
                if a >= n or a > b:
                    self.send_response(416); self.send_header('Content-Range', f'bytes */{n}'); self.send_header('Content-Length', '0')
                    self.end_headers(); return
                code, extra, body = 206, dict(extra or {}, **{'Content-Range': f'bytes {a}-{b}/{n}'}), body[a:b + 1]
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            if media:
                self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Cache-Control', 'no-store')   # models/textures change when the exporter improves
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers(); self.wfile.write(body)

        def js(self, obj, code=200):
            self.send(code, json.dumps(obj).encode(), 'application/json')

        def do_GET(self):
            u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
            try:
                if u.path in ('/', '/index.html'):
                    return self.send(200, open(os.path.join(STATIC, 'index.html'), 'rb').read(), 'text/html; charset=utf-8')
                if u.path in ('/fireworks.js', '/tour.js', '/parks.js', '/texgui.js', '/mods.js') or (u.path.startswith('/fw_') and u.path.endswith('.js') and '/' not in u.path[1:]
                                                 and os.path.exists(os.path.join(STATIC, u.path[1:]))):
                    return self.send(200, open(os.path.join(STATIC, u.path[1:]), 'rb').read(), 'text/javascript; charset=utf-8')
                # Mod Loader (static/mods.js, mods.py): custom content in the game
                if u.path == '/api/mods':
                    with lock:
                        return self.js(mods.scan(lib))
                if u.path == '/api/mods/package':
                    with lock:
                        return self.js(mods.details(lib, q['id']))
                if u.path == '/api/fw/data':
                    with lock:
                        return self.js({'fireworks': fw.list_fireworks(lib), 'displays': fw.list_displays(lib),
                                        'sprites': fw.sprites(lib), 'music': fw.music_list(lib),
                                        'lasers': fw.list_effects(lib, 'laser'), 'jets': fw.list_effects(lib, 'jet'),
                                        'drawings': fw.list_drawings(lib), 'sounds': fw.sound_names(lib),
                                        'can_play_music': fw._ffmpeg() is not None, 'launchers': fw.LAUNCHERS})
                if u.path == '/api/fw/mine':
                    with lock:
                        return self.js(fw.load_mine(lib))
                if u.path == '/api/fw/page':
                    with lock:
                        png = fw.page_png(lib, q['name'], q.get('opaque') == '1')
                    return self.send(200, png, 'image/png') if png else self.js({'error': 'no such page'}, 404)
                if u.path == '/api/fw/tex':
                    # any game texture by name (sky ramp, clouds, skylines, ground) for the fireworks scene
                    name = q.get('name', '')
                    if not name.replace('_', '').isalnum():
                        return self.js({'error': 'bad name'}, 400)
                    with lock:
                        img = lib.texture_image(name + ':tex')
                    if img is None:
                        return self.js({'error': 'no such texture'}, 404)
                    b = io.BytesIO(); img.save(b, 'PNG')
                    return self.send(200, b.getvalue(), 'image/png')
                if u.path == '/api/fw/sound':
                    with lock:
                        wav = fw.sound(lib, q['name'])
                    return self.send(200, wav, 'audio/wav') if wav else self.js({'error': 'no such sound'}, 404)
                if u.path == '/api/fw/launcher':
                    with lock:
                        res = fw.launcher(lib, q['name'])
                    if res is None:
                        return self.js({'error': 'no such launcher'}, 404)
                    return self.send(200, res[0], 'model/gltf-binary', {'X-Info': json.dumps(res[1])})
                if u.path == '/api/fw/music':
                    data = fw.music(lib, q['name'])          # may take a few seconds the first time (conversion)
                    if data is None:
                        return self.js({'error': 'could not convert the music (needs ffmpeg: start the viewer with --with imageio-ffmpeg)'}, 404)
                    return self.send(200, data, 'audio/ogg')
                if u.path == '/filetypes.md':
                    return self.send(200, open(os.path.join(STATIC, 'filetypes.md'), 'rb').read(), 'text/markdown; charset=utf-8')
                if u.path == '/api/tree':     # ?refresh=1: first look for OVLs added, changed or removed since
                    with lock:
                        changes = lib.refresh_index() if q.get('refresh') else None
                        return self.js({'root': lib.root, 'ovls': lib.index['ovls'], 'files': fw.list_files(lib), 'changes': changes})
                # texture & GUI editor (static/texgui.js, texedit.py)
                if u.path == '/api/tx/catalogue':
                    with lock:
                        return self.js({'textures': tx.catalogue(lib), 'edits': tx.edits(lib)})
                if u.path == '/api/tx/info':
                    with lock:
                        return self.js(tx.info(lib, q['path'], q['name']))
                if u.path == '/api/tx/image':
                    with lock:
                        o, ts, r = tx._ref(lib, q['path'], q['name'])
                        cols = [tuple(int(c[i:i + 2], 16) for i in (0, 2, 4)) if c else None
                                for c in q['colors'].split(',')] if q.get('colors') else None
                        img = ts.image(r, colors=cols, frame=int(q.get('frame', 0)))
                    if img is None:
                        return self.js({'error': 'no pixel data'}, 404)
                    b = io.BytesIO(); img.save(b, 'PNG')
                    return self.send(200, b.getvalue(), 'image/png')
                if u.path == '/api/tx/gui':
                    with lock:
                        return self.js(tx.gui_catalogue(lib))
                if u.path == '/api/tx/icons':
                    with lock:
                        return self.js(tx.icons(lib, q['path']))
                if u.path == '/api/tx/texts':
                    with lock:
                        return self.js(tx.texts(lib, q['path']))
                if u.path == '/api/tx/menu':
                    with lock:
                        return self.js({**frontscreen.layout(lib), 'themes': frontscreen.themes()})
                if u.path == '/api/parks':
                    with lock:
                        return self.js(parks.list_parks(lib))
                if u.path == '/api/park':
                    with lock:
                        if not parks.park_path(lib, q.get('file', '')):
                            return self.js({'error': 'no such park'}, 404)
                        return self.js(parks.finite({'info': parks.park_info(lib, q['file']), 'world': parks.park_world(lib, q['file'])}))
                if u.path == '/api/park_model':
                    with lock:
                        col = [int(x) for x in q['col'].split(',')][:3] if q.get('col') else None
                        res = parks.sid_model(lib, q['sid'], q.get('overlay', ''), col)
                    if res is None:
                        return self.js({'error': 'no model for this item'}, 404)
                    return self.send(200, res[0], 'model/gltf-binary', {'X-Info': json.dumps(res[1], default=str)})
                if u.path == '/api/park_person':
                    with lock:
                        res = parks.person_model(lib, [g for g in q.get('g', '').split(',') if g.endswith(':ppg')], int(q.get('lod', 1)))
                    if res is None:
                        return self.js({'error': 'no such person'}, 404)
                    return self.send(200, res[0], 'model/gltf-binary', {'X-Info': json.dumps(res[1], default=str)})
                if u.path == '/api/park_car':
                    with lock:
                        col = [int(x) for x in q['col'].split(',')][:3] if q.get('col') else None
                        res = parks.car_model(lib, q['rit'], q.get('overlay', ''), int(q.get('slot', 2)), q.get('part', 'main'), col)
                    if res is None:
                        return self.js({'error': 'no such car'}, 404)
                    return self.send(200, res[0], 'model/gltf-binary', {'X-Info': json.dumps(res[1], default=str)})
                if u.path == '/api/park_animal':
                    with lock:
                        res = parks.animal_model(lib, q['mdl'])
                    if res is None:
                        return self.js({'error': 'no such animal model'}, 404)
                    return self.send(200, res[0], 'model/gltf-binary', {'X-Info': json.dumps(res[1], default=str)})
                if u.path == '/api/park_track':
                    with lock:
                        glb, info = parks.track_model(lib, q['file'], int(q['id']))
                    head = {k: v for k, v in info.items() if k != 'supports'}
                    return self.send(200, glb, 'model/gltf-binary', {'X-Info': json.dumps(head, default=str)})
                if u.path == '/api/park_supports':
                    with lock:
                        glb, info = parks.track_model(lib, q['file'], int(q['id']))
                    return self.js(info.get('supports', []))
                if u.path == '/api/park_tex':
                    name, _, col = q.get('name', '').partition('|')     # 'Name:ftx|23,9,14': in those colours
                    cols = parks.flexi_colours([int(x) for x in col.split(',')][:3]) if col else None
                    with lock:
                        img = lib.texture_image(name, colors=cols) if name.lower().endswith((':tex', ':ftx')) else None
                    if img is None:
                        return self.js({'error': 'no such texture'}, 404)
                    b = io.BytesIO(); img.save(b, 'PNG')
                    return self.send(200, b.getvalue(), 'image/png')
                if u.path == '/api/fw/file':
                    with lock:
                        d = fw.file_info(lib, q['path'])
                    return self.js(d) if d else self.js({'error': 'no such file'}, 404)
                if u.path == '/api/fw/raw':
                    found = fw.file_path(lib, q['path'])
                    if not found:
                        return self.js({'error': 'no such file'}, 404)
                    name = os.path.basename(found[0]).encode('ascii', 'replace').decode()
                    return self.send(200, open(found[0], 'rb').read(), 'application/octet-stream',
                                     {'Content-Disposition': f'attachment; filename="{name}"'})
                if u.path == '/api/ovl':
                    with lock:
                        o, ts = lib.open(q['path'])
                        res = [{'name': r.name, 'tag': r.loader.tag, 'loader': r.loader.name, 'part': r.part,
                                'extra': len(r.extra)} for r in o.resources if r.loader.tag != 'txt']
                        texts = sum(1 for r in o.resources if r.loader.tag == 'txt')
                        return self.js({'path': q['path'], 'version': o.version, 'resources': res, 'texts': texts,
                                        'files': [os.path.basename(f.path) for f in o.files]})
                if u.path == '/api/texture':
                    with lock:
                        o, ts = lib.open(q['path'])
                        r = next(r for r in o.resources if r.name == q['name'])
                        img = ts.image(r)
                    if img is None:
                        return self.js({'error': 'no pixel data (engine placeholder texture)'}, 404)
                    b = io.BytesIO(); img.save(b, 'PNG')
                    return self.send(200, b.getvalue(), 'image/png',
                                     {'X-Size': f'{img.width}x{img.height}'})
                if u.path == '/api/model':
                    with lock:
                        o, ts = lib.open(q['path'])
                        r = next(r for r in o.resources if r.name == q['name'])
                        s = load_shape(o, r)
                        glb = shape_to_glb(s, lambda n: lib.texture_image(n, prefer=o))
                        info = {'meshes': [{'texture': m.texture, 'style': m.style, 'verts': int(len(m.positions)),
                                            'tris': int(len(m.indices) // 3), 'sides': m.sides,
                                            'transparency': m.transparency} for m in s.meshes],
                                'bones': [{'name': b.name, 'parent': b.parent} for b in s.bones],
                                'effects': [e[0] for e in s.effects]}
                    fn = r.name.split(':')[0] + '.glb'
                    return self.send(200, glb, 'model/gltf-binary',
                                     {'X-Info': json.dumps(info), 'Content-Disposition': f'inline; filename="{fn}"'})
                if u.path == '/api/res':
                    # any resource: model/morph/head -> GLB, texture/icon -> PNG, sound -> WAV, else JSON
                    anims = q['anims'].split(',') if q.get('anims') else None
                    with lock:
                        o, ts = lib.open(q['path'])
                        r = next(r for r in o.resources if r.name == q['name'])
                        if r.loader.tag == 'ftx' and q.get('colors'):
                            cols = [tuple(int(c[i:i + 2], 16) for i in (0, 2, 4)) if c else None
                                    for c in q['colors'].split(',')]
                            img = ts.image(r, colors=cols)
                            b = io.BytesIO(); img.save(b, 'PNG')
                            return self.send(200, b.getvalue(), 'image/png', {'X-Info': json.dumps({'size': list(img.size)})})
                        files, info = export_resource(lib, o, ts, r, anims, variant=int(q.get('outfit', 0)))
                    main = next((f for f in files if not f[0].startswith('data')), None)
                    data = [json.loads(f[2]) for f in files if f[0].startswith('data') or f[1].endswith('.json')]
                    hdr = {'X-Info': json.dumps(info, default=str)[:60000]}
                    if main and main[1].endswith('.glb'):
                        return self.send(200, main[2], 'model/gltf-binary', hdr)
                    if main and main[1].endswith('.png'):
                        return self.send(200, main[2], 'image/png', hdr)
                    if main and main[1].endswith('.wav'):
                        return self.send(200, main[2], 'audio/wav', hdr)
                    return self.js({'info': info, 'data': data})
                if u.path == '/api/texts':
                    with lock:
                        o, _ = lib.open(q['path'])
                        return self.js([{'name': r.name.split(':')[0], 'text': text(o, r)} for r in o.resources
                                        if r.loader.tag == 'txt'])
                if u.path == '/api/people':
                    with lock:
                        vs = variants(lib)
                        out = [describe_variant(lib, v, gs) for v, gs in sorted(vs.items())]
                    return self.js(out)
                if u.path == '/api/designs':
                    with lock:
                        titles = {s['ride']: s['title'] for s in track_sets(lib)}
                        return self.js([dict(d, ride_title=titles.get(d['ride_type'].lower() + ':trr', d['ride_type']),
                                             file=('yours/' if d['yours'] else '') + os.path.basename(d['file'])) for d in design_files(lib)])
                if u.path == '/api/design':
                    path = design_path(lib, q['file'])
                    with lock:
                        glb, info = build_design(lib, path)
                    return self.send(200, glb, 'model/gltf-binary', {'X-Info': json.dumps(info, default=str)[:60000]})
                if u.path == '/api/scenery':
                    with lock:
                        return self.js([{k: s[k] for k in ('name', 'title', 'type', 'category', 'theme', 'animations')}
                                        for s in list_scenery(lib)])
                if u.path == '/api/scenery_item':
                    with lock:
                        res = build_scenery(lib, q['name'])
                    if res is None:
                        return self.js({'error': 'no model found for this scenery item'}, 404)
                    return self.send(200, res[0], 'model/gltf-binary', {'X-Info': json.dumps(res[1], default=str)[:60000]})
                if u.path == '/api/items':
                    with lock:
                        return self.js(carried_items(lib))
                if u.path == '/api/tracksets':
                    with lock:
                        return self.js([{k: s[k] for k in ('ride', 'title', 'folder', 'track_ovls')} | {'count': len(s['pieces'])}
                                        for s in track_sets(lib)])
                if u.path == '/api/trackset':
                    with lock:
                        s = next((x for x in track_sets(lib) if x['ride'] == q['ride']), None)
                    if not s:
                        return self.js({'error': 'unknown ride'}, 404)
                    return self.js({'title': s['title'], 'folder': s['folder'], 'track_ovls': s['track_ovls'],
                                    'resources': [{'name': n, 'tag': 'tks', 'loader': 'TrackSection', 'part': '', 'ovl': p}
                                                  for p, n in s['pieces']]})
                if u.path == '/api/rides':
                    with lock:
                        return self.js([{k: r[k] for k in ('name', 'title', 'group')} for r in list_rides(lib)])
                if u.path == '/api/ride':
                    with lock:
                        res = build_ride(lib, q['name'])
                    if res is None:
                        return self.js({'error': 'no model found for this ride'}, 404)
                    return self.send(200, res[0], 'model/gltf-binary', {'X-Info': json.dumps(res[1], default=str)[:60000]})
                if u.path == '/api/person':
                    anims = q['anims'].split(',') if q.get('anims') else ['Walk']
                    with lock:
                        res = build_person(lib, q['variant'], anims, None, int(q.get('lod', 0)), q.get('expression', ''),
                                           int(q.get('outfit', 0)))
                    if res is None:
                        return self.js({'error': 'no parts found'}, 404)
                    return self.send(200, res[0], 'model/gltf-binary', {'X-Info': json.dumps(res[1], default=str)[:60000]})
                if u.path == '/api/search':
                    term = q.get('q', '').lower()
                    hits = [{'name': n, 'path': p} for n, p in lib.index['names'].items() if term in n][:300]
                    return self.js(hits)
                return self.js({'error': 'not found'}, 404)
            except StopIteration:
                return self.js({'error': 'resource not found'}, 404)
            except OvlError as e:      # e.g. a coaster of a custom ride that isn't installed (lay_track)
                return self.js({'error': str(e)}, 404)
            except Exception as e:
                traceback.print_exc()
                return self.js({'error': repr(e)}, 500)

    def do_POST(self):
        # fireworks editor: build a game file from edited data (download) or save it into the game folder
        u = urlparse(self.path)
        try:
            raw = self.rfile.read(int(self.headers.get('Content-Length') or 0))
            if u.path == '/api/mods/upload':     # a download added in the Mod Loader: the file's own bytes
                q = {k: v[0] for k, v in parse_qs(u.query).items()}
                with lock:
                    return self.js(mods.plan_upload(lib, q.get('name', 'download'), raw))
            body = json.loads(raw or b'{}')
            if u.path.startswith('/api/mods/'):
                with lock:
                    if u.path == '/api/mods/plan':        # a download already on this computer: archive, folder or file
                        return self.js(mods.plan_path(lib, body['path']))
                    if u.path == '/api/mods/install':
                        return self.js(mods.install(lib, body['token'], body.get('name'), body.get('leave_out')))
                    if u.path == '/api/mods/cancel':
                        mods.cancel(lib, body['token']); return self.js({'ok': True})
                    if u.path == '/api/mods/enable':
                        return self.js(mods.set_enabled(lib, body['id'], bool(body['on'])))
                    if u.path == '/api/mods/uninstall':
                        return self.js(mods.uninstall(lib, body['id']))
            if u.path.startswith('/api/tx/'):
                with lock:
                    if u.path == '/api/tx/write':
                        return self.js(tx.write_texture(lib, body['path'], body['name'], base64.b64decode(body['b64']), int(body.get('frame', 0))))
                    if u.path == '/api/tx/restore':
                        tx.restore(lib, body['path']); return self.js({'ok': True, 'edits': tx.edits(lib)})
                    if u.path == '/api/tx/rect':
                        return self.js(tx.set_icon_rect(lib, body['path'], body['name'], body['rect']))
                    if u.path == '/api/tx/text':
                        return self.js(tx.set_text(lib, body['path'], body['name'], body['text']))
                    if u.path == '/api/tx/menu':
                        r = frontscreen.set_layout(lib, body.get('values', {}), body.get('colour'))
                        if body.get('places') is not None:      # free places and each menu's buttons
                            r = frontscreen.set_menus(lib, body['places'], body['menus'])
                        return self.js(r)
                    if u.path == '/api/tx/menu/reset':
                        return self.js(frontscreen.reset_layout(lib))
                    if u.path == '/api/tx/menu/theme':
                        r = frontscreen.apply_theme(lib, body['name'], bool(body.get('restore_main')))
                        return self.js({**r, 'edits': tx.edits(lib)})
                    if u.path == '/api/tx/exe':
                        return self.js({'edits': tx.patch_exe(lib, body.get('name', 'RCT3plus.exe'), body['patches'], body.get('what', 'layout'))})
            if u.path == '/api/fw/build':
                with lock:
                    blob = fw.build(lib, body['kind'], body['data'])
                name = (body.get('name') or 'export') + fw.EXT[body['kind']]
                return self.send(200, blob, 'application/octet-stream',
                                 {'Content-Disposition': f'attachment; filename="{name}"'})
            if u.path == '/api/fw/parse':     # a firework / laser / water jet file opened from anywhere
                with lock:
                    return self.js(fw.parse_upload(lib, os.path.basename(body.get('name', '')), base64.b64decode(body['b64'])))
            if u.path == '/api/fw/mine':
                with lock:
                    fw.save_mine(lib, body)
                return self.js({'ok': True})
            if u.path == '/api/fw/save':
                with lock:
                    path = fw.save_to_game(lib, body['kind'], body.get('name') or 'My effect', body['data'])
                return self.js({'path': path, 'file': os.path.basename(path)})
            return self.js({'error': 'not found'}, 404)
        except Exception as e:
            traceback.print_exc()
            return self.js({'error': str(e)}, 500)

    H.do_POST = do_POST
    httpd = ThreadingHTTPServer(('127.0.0.1', port), H)
    url = f'http://127.0.0.1:{port}/'
    print(f'RCT3 OVL viewer: {url}  (game folder: {lib.root})  Ctrl+C to stop')
    if open_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
