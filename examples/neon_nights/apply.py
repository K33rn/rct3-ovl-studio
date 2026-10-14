"""Neon Nights: put the custom front screen into the game through a running viewer (Textures & GUI tab's API).

usage: python apply.py [http://localhost:8766]
Downloads the original front-screen textures, draws the theme (neon.py, needs Pillow + numpy), saves the textures
and the menu texts into the game, and moves the main menu's buttons and recolours their bars in RCT3plus.exe. The viewer backs the files up first; Textures & GUI > Changed files puts them back.
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
# The front screen's buttons sit on arcs round the big circle's centre (RCT3plus.exe 0xa45670: centre 734, 527 of a
# 1024 x 768 layout; the main menu's disc centres land at 734 + r cos(t), 239.5 - r sin(t), t = start + step x slot).
# The main menu (and the Tools menu, which uses the same slots) is moved from the left edge to an even arc at the top
# of the circle; the bars' colour is an ARGB value in the code (0xa4b48e, mov [eax], 0xfff7f2f2).
EXE = [{'va': 0xf8db6c, 'old': 650.0, 'f32': 360.0},        # radius (0xa45110, type 0)
       {'va': 0xf8db84, 'old': 3.06, 'f32': 2.7216},        # first angle (0xa451d0, type 0)
       {'va': 0xf8db80, 'old': 0.165, 'f32': 0.29},         # angle per button
       {'va': 0xa4b490, 'old': 0xfff7f2f2, 'u32': 0xff28f0ff}]   # bar colour: neon cyan
r = post('/api/tx/exe', {'name': 'RCT3plus.exe', 'patches': EXE, 'what': 'Neon Nights button layout'})
print('RCT3plus.exe', r.get('error', 'patched'))
for k, v in TEXTS.items():
    r = post('/api/tx/text', {'path': 'gui\\English.common.ovl', 'name': k, 'text': v})
    print('text', k, repr(r.get('text')), r.get('error', ''))
