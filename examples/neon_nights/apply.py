"""Neon Nights: the custom front screen, applied through a running viewer.

usage: python apply.py [http://localhost:8766]
The same as Textures & GUI > GUI Editor > Front screen > Themes > Neon Nights: draws the theme from the game's own
front-screen textures (rct3ovl/themes/neon_nights.py) and saves the textures, the menu words and the button layout
(RCT3plus.exe) into the game. The viewer backs the files up first; Changed files > Restore puts them back.
Close RollerCoaster Tycoon 3 first."""
import json, sys, urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8766').rstrip('/')
req = urllib.request.Request(BASE + '/api/tx/menu/theme', json.dumps({'name': 'neon_nights', 'restore_main': True}).encode(),
                             {'Content-Type': 'application/json'})
try:
    r = json.loads(urllib.request.urlopen(req).read())
    print('saved: ' + ', '.join(sorted(r['edits'])))
except urllib.error.HTTPError as e:
    print('error:', json.loads(e.read()).get('error'))
