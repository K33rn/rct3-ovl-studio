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

from .gltf import shape_to_glb
from .library import Library
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
