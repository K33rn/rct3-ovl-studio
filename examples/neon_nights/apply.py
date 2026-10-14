"""Neon Nights: put the custom front screen into the game through a running viewer (Textures & GUI tab's API).

usage: python apply.py [http://localhost:8766]
Downloads the original front-screen textures, draws the theme (neon.py, needs Pillow + numpy), saves the textures
and the menu texts into the game. The viewer backs the files up first; Textures & GUI > Changed files puts them back.
Close RollerCoaster Tycoon 3 first."""
import base64, json, os, subprocess, sys, tempfile, urllib.parse, urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8766').rstrip('/')
TEX = ['FrontEndBG1', 'FrontEndBG1b', 'FrontEndBG2', 'FrontEndBG3', 'FrontEndBG4', 'FrontEndParts', 'FrontEndIcons',
       'FrontEndLogo', 'GUI2Main2']
TEXTS = {'FrontScreen_Play_TT': 'RIDE', 'FrontScreen_Tools_TT': 'BUILD', 'FrontScreen_Options_TT': 'SETUP',
         'FrontScreen_MainMenu': 'NEON PARK', 'FrontScreen_Play_Help': 'Ride all night under neon',
         'FrontScreen_Tools_Help': 'Build your dreams', 'FrontScreen_Options_Help': 'Tune the lights',
         'FrontScreen_PlayMenu': 'RIDE MENU', 'FrontScreen_ToolMenu': 'BUILD MENU', 'FrontScreen_Exit_TT': 'EXIT'}


def post(path, body):
    req = urllib.request.Request(BASE + path, json.dumps(body).encode(), {'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req).read())


src, out = tempfile.mkdtemp(), tempfile.mkdtemp()
for n in TEX:          # the game's textures: run this on the originals (restore Main first if it was changed)
    q = urllib.parse.urlencode({'path': 'Main.common.ovl', 'name': n + ':tex', 'frame': 0})
    open(os.path.join(src, n + '.png'), 'wb').write(urllib.request.urlopen(f'{BASE}/api/tx/image?{q}').read())
subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'neon.py'), src, out], check=True)
for n in TEX:
    r = post('/api/tx/write', {'path': 'Main.common.ovl', 'name': n + ':tex',
                               'b64': base64.b64encode(open(os.path.join(out, n + '.png'), 'rb').read()).decode()})
    print('texture', n, r.get('error', 'saved'))
for k, v in TEXTS.items():
    r = post('/api/tx/text', {'path': 'gui\\English.common.ovl', 'name': k, 'text': v})
    print('text', k, repr(r.get('text')), r.get('error', ''))
