"""Local web viewer: python -m rct3ovl view <game folder>. Serves a small JSON API + a three.js page."""
from __future__ import annotations

import io
import json
import os
import threading
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .characters import build_person, carried_items, describe_variant, variants
from .rides import build_ride, list_rides, track_sets
from .export import export_resource
from .gltf import shape_to_glb
from .library import Library
from .media import text
from .meshes import load_shape

STATIC = os.path.join(os.path.dirname(__file__), 'static')


def serve(root: str, port: int = 8765, open_browser: bool = True):
    lib = Library(root)
    lock = threading.Lock()                 # Library caches are not thread-safe

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body: bytes, ctype: str, extra: dict | None = None):
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
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
                if u.path == '/filetypes.md':
                    return self.send(200, open(os.path.join(STATIC, 'filetypes.md'), 'rb').read(), 'text/markdown; charset=utf-8')
                if u.path == '/api/tree':
                    return self.js({'root': lib.root, 'ovls': lib.index['ovls']})
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
            except Exception as e:
                traceback.print_exc()
                return self.js({'error': repr(e)}, 500)

    httpd = ThreadingHTTPServer(('127.0.0.1', port), H)
    url = f'http://127.0.0.1:{port}/'
    print(f'RCT3 OVL viewer: {url}  (game folder: {lib.root})  Ctrl+C to stop')
    if open_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
