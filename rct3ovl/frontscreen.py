"""Front screen (the game's main menus) layout, read from and written into RCT3plus.exe.

The front screen is built in code. Every menu button is added by 0xa47190(type, slot, button, icon, menu, flag); its
centre is placed on an arc round the big circle (0xa45670): x = 734 + r cos(a), y = 239.5 - r sin(a) in the 1024 x 768
layout, with r from 0xa45110(type), a = start + step x slot from 0xa451d0(type, slot) and the badge size from
0xa45570(type). Types in use: 0 = the buttons of every menu (main, Play, Tools, Sandbox, Custom scenario: slots 0-3),
4 = the Back / Quit buttons (slots 4, 5; also the scenario-end menu), 3 = list entries, 5 = tutorial pages (slot -1 =
the 'forward' button, with its own start). The bars' colour is an ARGB immediate (0xa4b48e: mov [eax], 0xfff7f2f2).

Each number is read by one 'fld dword [addr]' (D9 05 addr). Several types share their constants with unrelated code,
so to change one the instruction is pointed at a slot of its own in the int3 padding between functions (never run,
readable like the rest of the code) and the value is written there. Everything goes through texedit.patch_exe: the
original program is copied first and Changed files > Restore puts it back.
"""
from __future__ import annotations

import os
import struct

from . import texedit as tx

EXE = 'RCT3plus.exe'
# key: (label, group, [instruction addresses], original constant address, padding slot)
PARAMS = {
    'menu_r':       ('Distance from the centre', 'menu', [0xa45120], 0xf8db6c, 0xa450c4),
    'menu_start':   ('First button angle', 'menu', [0xa451f4], 0xf8db84, 0xa450c8),
    'menu_step':    ('Angle between buttons', 'menu', [0xa451fa], 0xf8db80, 0xa450cc),
    'menu_size':    ('Badge size', 'menu', [0xa45580], 0xf6f5a0, 0xa450e4),
    'corner_r':     ('Distance from the centre', 'corner', [0xa45144], 0xf79714, 0xa450e8),
    'corner_start': ('First button angle', 'corner', [0xa45268], 0xf68c34, 0xa450ec),
    'corner_step':  ('Angle between buttons', 'corner', [0xa4526e], 0xf36790, 0xa45104),
    'list_r':       ('Distance from the centre', 'list', [0xa4513b], 0xf8db64, 0xa45108),
    'list_start':   ('First entry angle', 'list', [0xa4524b], 0xf8db78, 0xa4510c),
    'list_step':    ('Angle between entries', 'list', [0xa45251], 0xf33750, 0xa4517c),
    'list_size':    ('Badge size (lists, tutorial)', 'list', [0xa45597], 0xf27844, 0xa451c8),
    'tut_r':        ('Distance from the centre', 'tutorial', [0xa4514d], 0xf4c75c, 0xa451cc),
    'tut_start':    ('First page angle', 'tutorial', [0xa452a6], 0xf8db70, 0xa452dc),
    'tut_fwd':      ('Forward button angle', 'tutorial', [0xa4528d], 0xf8db74, 0xa45348),
    'tut_step':     ('Angle between pages', 'tutorial', [0xa45293, 0xa452ac], 0xf270b8, 0xa4534c),
}
GROUPS = {'menu': 'Menu buttons (every menu)', 'corner': 'Back / Quit buttons', 'list': 'Scenario lists',
          'tutorial': 'Tutorial pages'}
ANGLES = {'menu_start', 'menu_step', 'corner_start', 'corner_step', 'list_start', 'list_step', 'tut_start', 'tut_fwd',
          'tut_step'}
COLOUR_AT, COLOUR_ORIG = 0xa4b490, 0xfff7f2f2
SANE = {'r': (-2000.0, 2000.0), 'size': (8.0, 400.0), 'angle': (-50.0, 50.0)}


def _exe(lib) -> tuple[str, bytes]:
    p = os.path.join(lib.root, EXE)
    if not os.path.exists(p):
        raise FileNotFoundError(f'{EXE} is not in the game folder')
    return p, open(p, 'rb').read()


def _f32(d: bytes, va: int) -> float:
    return struct.unpack_from('<f', d, tx._exe_offset(d, va))[0]


def _u32(d: bytes, va: int) -> int:
    return struct.unpack_from('<I', d, tx._exe_offset(d, va))[0]


def _check(d: bytes):
    """Refuse a program this was not worked out on: every instruction must be fld [the original or our slot]."""
    for key, (_, _, ins, orig, slot) in PARAMS.items():
        for a in ins:
            o = tx._exe_offset(d, a)
            if d[o:o + 2] != b'\xd9\x05' or struct.unpack_from('<I', d, o + 2)[0] not in (orig, slot):
                raise ValueError(f'{EXE} is a version the menu designer does not know (at {a:#x})')
        if struct.unpack_from('<I', d, tx._exe_offset(d, ins[0]) + 2)[0] == orig and _u32(d, slot) != 0xCCCCCCCC:
            raise ValueError(f'{EXE}: the free space at {slot:#x} is in use')
    v = _u32(d, COLOUR_AT - 2)
    if v & 0xffff != 0x00c7:          # c7 00 (mov dword [eax], imm32)
        raise ValueError(f'{EXE} is a version the menu designer does not know (colour)')


def layout(lib) -> dict:
    """The values the game uses now (following any redirection) and the originals."""
    _, d = _exe(lib)
    _check(d)
    od = open(tx._lp(_original(lib)), 'rb').read() if _original(lib) else d     # the game's own numbers
    out = []
    for key, (label, group, ins, orig, slot) in PARAMS.items():
        ptr = struct.unpack_from('<I', d, tx._exe_offset(d, ins[0]) + 2)[0]
        out.append({'key': key, 'label': label, 'group': group, 'angle': key in ANGLES,
                    'value': _f32(d, ptr), 'orig': _f32(od, orig)})
    return {'params': out, 'groups': GROUPS, 'colour': _u32(d, COLOUR_AT), 'colour_orig': COLOUR_ORIG,
            'changed': EXE in tx.edits(lib)}


def _original(lib) -> str | None:
    p = os.path.join(tx._backup_dir(lib), EXE)
    return p if os.path.exists(tx._lp(p)) else None


def set_layout(lib, values: dict, colour: int | None = None) -> dict:
    """values: {key: number}. Points each changed number's instruction at its own slot and writes it there."""
    _, d = _exe(lib)
    _check(d)
    patches = []
    for key, v in values.items():
        if key not in PARAMS:
            raise KeyError(key)
        v = float(v)
        lo, hi = SANE['angle' if key in ANGLES else 'size' if key.endswith('size') else 'r']
        if not lo <= v <= hi:
            raise ValueError(f'{PARAMS[key][0]}: {v} is out of range')
        _, _, ins, orig, slot = PARAMS[key]
        for a in ins:
            patches.append({'va': a + 2, 'u32': slot})
        patches.append({'va': slot, 'f32': v})
    if colour is not None:
        patches.append({'va': COLOUR_AT, 'u32': int(colour) & 0xffffffff})
    if patches:
        tx.patch_exe(lib, EXE, patches, 'Front screen layout')
    return layout(lib)


def reset_layout(lib) -> dict:
    """Every number back to the game's own (the instructions point at the original constants again)."""
    _, d = _exe(lib)
    _check(d)
    od = open(tx._lp(_original(lib)), 'rb').read() if _original(lib) else None
    patches = []
    for key, (_, _, ins, orig, slot) in PARAMS.items():
        for a in ins:
            patches.append({'va': a + 2, 'u32': orig})
        patches.append({'va': slot, 'u32': 0xCCCCCCCC})        # the padding as it was
        if od is not None:
            patches.append({'va': orig, 'f32': _f32(od, orig)})   # constants an earlier version wrote in place
    patches.append({'va': COLOUR_AT, 'u32': COLOUR_ORIG})
    tx.patch_exe(lib, EXE, patches, 'Front screen layout')
    return layout(lib)


# ---- themes: whole front screens in one go ---------------------------------------------------------------------
THEME_TEXTURES = ['FrontEndBG1', 'FrontEndBG1b', 'FrontEndBG2', 'FrontEndBG3', 'FrontEndBG4', 'FrontEndParts',
                  'FrontEndIcons', 'FrontEndLogo', 'GUI2Main2']
THEMES = {
    'neon_nights': {
        'title': 'Neon Nights',
        'about': 'Night sky with a city and a synthwave sun, pink neon ring, RCT3 NEON NIGHTS logo, neon icons in '
                 'hexagon badges on cyan bars along the top of the circle, a giant neon ferris wheel and coaster.',
        'script': 'neon_nights.py',
        'texts': {'FrontScreen_Play_TT': 'RIDE', 'FrontScreen_Tools_TT': 'BUILD', 'FrontScreen_Options_TT': 'SETUP',
                  'FrontScreen_MainMenu': 'NEON PARK', 'FrontScreen_Play_Help': 'Ride all night under neon',
                  'FrontScreen_Tools_Help': 'Build your dreams', 'FrontScreen_Options_Help': 'Tune the lights',
                  'FrontScreen_PlayMenu': 'RIDE MENU', 'FrontScreen_ToolMenu': 'BUILD MENU', 'FrontScreen_Exit_TT': 'EXIT'},
        'layout': {'menu_r': 360.0, 'menu_start': 2.7216, 'menu_step': 0.29},
        'colour': 0xff28f0ff,
    },
}
MAIN = 'Main.common.ovl'


def themes() -> list[dict]:
    return [{'name': k, 'title': v['title'], 'about': v['about']} for k, v in THEMES.items()]


def apply_theme(lib, name: str, restore_main: bool = False) -> dict:
    """Draw a theme from the game's own front-screen textures and save it all: textures, menu texts, layout."""
    import subprocess
    import sys
    import tempfile
    th = THEMES[name]
    changed = tx.edits(lib).get(MAIN, {}).get('changes', [])
    if any(c.split(':')[0] in THEME_TEXTURES for c in changed):
        if not restore_main:
            raise ValueError('the front-screen textures are already changed: restore Main first')
        tx.restore(lib, MAIN)
    src, out = tempfile.mkdtemp(), tempfile.mkdtemp()
    for n in THEME_TEXTURES:
        o, ts, r = tx._ref(lib, MAIN, n + ':tex')
        ts.image(r).save(os.path.join(src, n + '.png'))
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'themes', th['script'])
    res = subprocess.run([sys.executable, script, src, out], capture_output=True, text=True)
    if res.returncode:
        raise RuntimeError('the theme could not be drawn: ' + (res.stderr.strip().splitlines() or ['?'])[-1])
    for n in THEME_TEXTURES:
        tx.write_texture(lib, MAIN, n + ':tex', open(os.path.join(out, n + '.png'), 'rb').read())
    lang = next((o['path'] for o in tx.gui_catalogue(lib).get('texts', []) if o['path'].lower().endswith('english.common.ovl')), None)
    if lang:
        for k, v in th['texts'].items():
            tx.set_text(lib, lang, k, v)
    return set_layout(lib, th['layout'], th['colour'])
