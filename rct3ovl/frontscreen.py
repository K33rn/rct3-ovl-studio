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

import math
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
GROUPS = {'menu': 'Menu buttons (every menu)', 'corner': 'Corner arc (scenario-end menu; Back / Quit until moved under Other pieces)', 'list': 'Scenario lists',
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
    return {'params': out, 'groups': GROUPS, 'colour': _u32(d, COLOUR_AT), 'colour_orig': COLOUR_ORIG, 'menus': menus(lib, d),
            'pieces': pieces(lib, d), 'changed': EXE in tx.edits(lib)}


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
    if menus_installed(d):
        patches += _menus_uninstall()
    if pieces_installed(d):
        patches += _pieces_uninstall()
    if menus_installed(d) or pieces_installed(d):
        patches.append({'off': _text_vsize_off(d), 'u32': TEXT_VSIZE})
    tx.patch_exe(lib, EXE, patches, 'Front screen layout')
    return layout(lib)


# ---- menus: free places and which buttons each menu shows --------------------------------------------------------
# Every front-screen menu button is a widget made once by the front screen's constructor (0xa4c810) and put in its
# menu by one call 0xa47190(type 0, slot, button, icon, menu, 0) at the end of it. Its place is slot n of the arc:
# the button's angle and radius (0xa451d0 / 0xa45110) feed the animator that slides it in when the menu opens, and
# the bar behind it with its words is the slot's own ButtonBox ([front + 0x100 + 4n], placed by slot as well). So:
#  - places: a code cave makes angle(type 0, slot < 5) and r(type 0, slot < 5) read a table of 5 angle / radius
#    pairs, so each of the 5 places can be anywhere on the screen (badge, bar and animation follow; shared by every
#    menu, like the game's own arc);
#  - menus: each button's call gets its own slot byte, menu field and target patched in place - a button can sit in
#    any menu at any place, and a removed button's call goes to a 'ret 0x18' stub, so it is never put in a menu.
# The cave lives in the zero-filled end of .text (file-backed; VirtualSize is raised to cover it).
CAVE = 0xf25d00
MAGIC = b'RCT3OVL MENUS v1'
ANG_AT, RAD_AT = CAVE + 0x10, CAVE + 0x24
SKIP = CAVE + 0xc0
PLACES = 5
CAVE_CODE = [
    # angle(type 0, slot): slot < 5 -> ANG[slot] (else the game's start + step x slot)
    (CAVE + 0x40, '8b44240883f805730eddd8ddd8d90485105df200c20800e994f4b1ff'),
    # r(type 0) with the slot in eax: slot < 5 -> RAD[slot] (else the game's own)
    (CAVE + 0x60, '837c240400750f83f805730ad90485245df200c20400e995f3b1ff'),
    (CAVE + 0x80, '8b442420ebda'),      # from 0xa457a0: slot = its 3rd argument
    (CAVE + 0x90, '8b442454ebca'),      # from 0xa47190: slot = its 2nd argument
    (CAVE + 0xa0, '89f8ebbc'),          # from the resize pass's ButtonBox loop: slot = edi
    (CAVE + 0xb0, '89e8ebac'),          # from the constructor's ButtonBox loop: slot = ebp
    (SKIP, 'c21800'),                   # a removed button: 0xa47190's arguments dropped, nothing done
]
ANGLE_CASE0, ANGLE_JT0 = 0xa451f0, 0xa452c0          # 0xa451d0's jump-table entry for type 0
R_FUNC = 0xa45110
R_CALLS = {0xa457ab: CAVE + 0x80, 0xa47285: CAVE + 0x90, 0xa47d79: CAVE + 0xa0, 0xa4f18b: CAVE + 0xb0}
ADD_BUTTON = 0xa47190
TEXT_VSIZE = 0xb24ce5                                   # .text VirtualSize (raised to 0xb25000)
MENUS_SPACE = 0x180                                     # the menus' part of the cave; the pieces use the rest
MENU_FIELDS = {'main': 0x340, 'play': 0x314, 'tools': 0x32c, 'sandbox': 0x250, 'custom': 0x2b4}
MENU_TITLES = {'main': 'Main menu', 'play': 'Play', 'tools': 'Tools', 'sandbox': 'Sandbox', 'custom': 'Custom scenario'}
# key: (button field, call 0xa47190, push slot, mov reg [esi + menu], home menu, home slot, label, text, icon)
BUTTONS = {
    'play':        (0x344, 0xa50158, 0xa50152, 0xa5013d, 'main', 0, 'Play', 'FrontScreen_Play_TT', 'Play'),
    'tools':       (0x348, 0xa50178, 0xa50172, 0xa5015d, 'main', 1, 'Tools (designers)', 'FrontScreen_Tools_TT', 'Designers'),
    'options':     (0x350, 0xa50198, 0xa50192, 0xa5017d, 'main', 2, 'Options', 'FrontScreen_Options_TT', 'Options'),
    'tutorial':    (0x324, 0xa50058, 0xa50052, 0xa5003d, 'play', 0, 'Tutorial', 'FrontScreen_Tutorial_TT', 'Tutorial'),
    'career':      (0x318, 0xa50078, 0xa50072, 0xa5005d, 'play', 1, 'Career', 'FrontScreen_Career_TT', 'Career'),
    'sandbox':     (0x320, 0xa50098, 0xa50092, 0xa5007d, 'play', 2, 'Sandbox', 'FrontScreen_Sandbox_TT', 'Sandbox'),
    'custom':      (0x328, 0xa500b8, 0xa500b2, 0xa5009d, 'play', 3, 'Custom scenario', 'FrontScreen_LoadScenario_TT', 'StartSandbox'),
    'people':      (0x334, 0xa500d8, 0xa500d2, 0xa500bd, 'tools', 0, 'People designer', 'FrontScreen_PeopleDesigner_TT', 'PersonDesigner'),
    'scenario_ed': (0x330, 0xa500f8, 0xa500f2, 0xa500dd, 'tools', 1, 'Scenario editor', 'FrontScreen_ScenarioEditor_TT', 'ScenarioEditor'),
    'coaster':     (0x338, 0xa50118, 0xa50112, 0xa500fd, 'tools', 2, 'Coaster designer', 'FrontScreen_CoasterDesigner_TT', 'CoasterEditor'),
    'building':    (0x33c, 0xa50138, 0xa50132, 0xa5011f, 'tools', 3, 'Building designer', 'FrontScreen_BuildingDesigner_TT', 'BuildingDesigner'),
    'new':         (0x254, 0xa4ff55, 0xa4ff4f, 0xa4ff3a, 'sandbox', 0, 'New sandbox', 'FrontScreen_New_TT', 'NewScenario'),
    'load':        (0x2ac, 0xa4ff75, 0xa4ff6f, 0xa4ff5a, 'sandbox', 1, 'Load sandbox', 'FrontScreen_Load_TT', 'Load'),
    'custom_new':  (0x2b8, 0xa4ff15, 0xa4ff0f, 0xa4fefa, 'custom', 0, 'New custom scenario', 'FrontScreen_New_TT', 'NewScenario'),
    'custom_load': (0x310, 0xa4ff35, 0xa4ff2f, 0xa4ff1a, 'custom', 1, 'Load custom scenario', 'FrontScreen_Load_TT', 'Load'),
}
CENTRE = (734.0, 239.5)          # x = 734 + r cos a, y = 239.5 - r sin a (the 1024 x 768 layout)
PARKED = 1.885                   # the animator's resting angle: targets are kept within half a turn of it


def _text_vsize_off(d: bytes) -> int:
    pe = struct.unpack_from('<I', d, 0x3c)[0]
    return pe + 24 + struct.unpack_from('<H', d, pe + 20)[0] + 8


def menus_installed(d: bytes) -> bool:
    try:
        o = tx._exe_offset(d, CAVE)
    except ValueError:
        return False
    return bytes(d[o:o + 16]) == MAGIC


def _rel(at: int, target: int) -> int:
    return (target - (at + 5)) & 0xffffffff


def _check_menus(d: bytes):
    """Refuse a program this was not worked out on (every byte the menus touch, as the game has it or as we left it)."""
    def bad(what):
        raise ValueError(f'{EXE} is a version the menu designer does not know ({what})')
    inst = menus_installed(d)
    vs = struct.unpack_from('<I', d, _text_vsize_off(d))[0]
    if vs not in (TEXT_VSIZE, 0xb25000):
        bad('section size')
    if not inst:
        o = tx._exe_offset(d, CAVE)
        if any(d[o:o + MENUS_SPACE]):
            bad('free space at the end of the code is in use')
    if _u32(d, ANGLE_JT0) not in (ANGLE_CASE0, CAVE + 0x40):
        bad('angle table')
    for at, stub in R_CALLS.items():
        o = tx._exe_offset(d, at)
        if d[o] != 0xe8 or struct.unpack_from('<I', d, o + 1)[0] not in (_rel(at, R_FUNC), _rel(at, stub)):
            bad(f'{at:#x}')
    for key, (field, call, push, mov, *_r) in BUTTONS.items():
        o = tx._exe_offset(d, call)
        if d[o] != 0xe8 or struct.unpack_from('<I', d, o + 1)[0] not in (_rel(call, ADD_BUTTON), _rel(call, SKIP)):
            bad(f'{key} call')
        o = tx._exe_offset(d, push)
        if d[o] != 0x6a or d[o + 1] >= PLACES:
            bad(f'{key} slot')
        o = tx._exe_offset(d, mov)
        if d[o] != 0x8b or d[o + 1] not in (0x86, 0x8e, 0x96) or \
                struct.unpack_from('<I', d, o + 2)[0] not in MENU_FIELDS.values():
            bad(f'{key} menu')


def _arc_places(d: bytes) -> list[list[float]]:
    """The places the game's own arc gives (whatever the arc numbers are now)."""
    get = {k: _f32(d, struct.unpack_from('<I', d, tx._exe_offset(d, PARAMS[k][2][0]) + 2)[0])
           for k in ('menu_r', 'menu_start', 'menu_step')}
    return [[round(CENTRE[0] + get['menu_r'] * math.cos(get['menu_start'] + get['menu_step'] * n), 2),
             round(CENTRE[1] - get['menu_r'] * math.sin(get['menu_start'] + get['menu_step'] * n), 2)]
            for n in range(PLACES)]


def menus(lib, d: bytes | None = None) -> dict:
    """Where the 5 places are and which buttons each menu shows, in place order."""
    if d is None:
        _, d = _exe(lib)
    _check_menus(d)
    inst = menus_installed(d)
    if inst:
        places = []
        for n in range(PLACES):
            a, r = _f32(d, ANG_AT + 4 * n), _f32(d, RAD_AT + 4 * n)
            places.append([round(CENTRE[0] + r * math.cos(a), 2), round(CENTRE[1] - r * math.sin(a), 2)])
    else:
        places = _arc_places(d)
    by_menu = {m: [None] * PLACES for m in MENU_FIELDS}
    removed = []
    field_menu = {v: k for k, v in MENU_FIELDS.items()}
    for key, (field, call, push, mov, *_r) in BUTTONS.items():
        o = tx._exe_offset(d, call)
        if struct.unpack_from('<I', d, o + 1)[0] == _rel(call, SKIP):
            removed.append(key)
            continue
        slot = d[tx._exe_offset(d, push) + 1]
        menu = field_menu[struct.unpack_from('<I', d, tx._exe_offset(d, mov) + 2)[0]]
        by_menu[menu][slot] = key
    return {'installed': inst, 'places': places, 'arc_places': _arc_places(d),
            'menus': {m: [k for k in v if k] for m, v in by_menu.items()}, 'removed': removed,
            'menu_titles': MENU_TITLES,
            'buttons': {k: {'label': v[6], 'text': v[7], 'icon': v[8], 'home': v[4]} for k, v in BUTTONS.items()},
            'game_menus': {m: [k for k, v in sorted(BUTTONS.items(), key=lambda kv: kv[1][5]) if v[4] == m]
                           for m in MENU_FIELDS}}


def _menus_install() -> list[dict]:
    p = [{'va': CAVE, 'hex': MAGIC.hex()}]
    p += [{'va': a, 'hex': h} for a, h in CAVE_CODE]
    p.append({'va': ANGLE_JT0, 'u32': CAVE + 0x40})
    p += [{'va': at + 1, 'u32': _rel(at, stub)} for at, stub in R_CALLS.items()]
    return p


def _menus_uninstall() -> list[dict]:
    """Everything back as the game has it: cave zeroed, hooks and every button's call, slot and menu."""
    p = [{'va': CAVE, 'hex': '00' * MENUS_SPACE}, {'va': ANGLE_JT0, 'u32': ANGLE_CASE0}]
    p += [{'va': at + 1, 'u32': _rel(at, R_FUNC)} for at in R_CALLS]
    for key, (field, call, push, mov, home, slot, *_r) in BUTTONS.items():
        p += [{'va': call + 1, 'u32': _rel(call, ADD_BUTTON)}, {'va': push + 1, 'hex': f'{slot:02x}'},
              {'va': mov + 2, 'u32': MENU_FIELDS[home]}]
    return p


def set_menus(lib, places: list, menu_lists: dict) -> dict:
    """places: 5 [x, y] in the 1024 x 768 layout; menu_lists: {menu: [button keys in place order]} - a button in
    no list is removed. Writes the cave (first time), the places and every button's menu, place and call."""
    _, d = _exe(lib)
    _check(d)
    _check_menus(d)
    if len(places) != PLACES:
        raise ValueError(f'{PLACES} places are needed')
    seen = set()
    for m, keys in menu_lists.items():
        if m not in MENU_FIELDS:
            raise KeyError(m)
        if len(keys) > PLACES:
            raise ValueError(f'{MENU_TITLES[m]}: a menu holds up to {PLACES} buttons (the game has {PLACES} places)')
        for k in keys:
            if k not in BUTTONS:
                raise KeyError(k)
            if k in seen:
                raise ValueError(f'{BUTTONS[k][6]} is in two menus - each game button can be in one menu')
            seen.add(k)
    if not menu_lists.get('main'):
        raise ValueError('the main menu needs at least one button')
    patches = [] if menus_installed(d) else _menus_install()
    patches.append({'off': _text_vsize_off(d), 'u32': 0xb25000})
    for n, (x, y) in enumerate(places):
        x, y = float(x), float(y)
        if not (-300 <= x <= 1324 and -300 <= y <= 1068):
            raise ValueError(f'place {n + 1} ({x:.0f}, {y:.0f}) is off the screen')
        dx, dy = x - CENTRE[0], CENTRE[1] - y
        r = max(math.hypot(dx, dy), 0.5)
        a = math.atan2(dy, dx)
        while a < PARKED - math.pi:
            a += 2 * math.pi
        while a > PARKED + math.pi:
            a -= 2 * math.pi
        patches += [{'va': ANG_AT + 4 * n, 'f32': a}, {'va': RAD_AT + 4 * n, 'f32': r}]
    where = {k: (m, n) for m, keys in menu_lists.items() for n, k in enumerate(keys)}
    for key, (field, call, push, mov, *_r) in BUTTONS.items():
        if key in where:
            m, n = where[key]
            patches += [{'va': call + 1, 'u32': _rel(call, ADD_BUTTON)}, {'va': push + 1, 'hex': f'{n:02x}'},
                        {'va': mov + 2, 'u32': MENU_FIELDS[m]}]
        else:
            patches.append({'va': call + 1, 'u32': _rel(call, SKIP)})
    tx.patch_exe(lib, EXE, patches, 'Front screen layout')
    return layout(lib)


def reset_menus(lib) -> dict:
    _, d = _exe(lib)
    _check_menus(d)
    if menus_installed(d):
        vs = [] if pieces_installed(d) else [{'off': _text_vsize_off(d), 'u32': TEXT_VSIZE}]
        tx.patch_exe(lib, EXE, _menus_uninstall() + vs, 'Front screen layout')
    return layout(lib)


# ---- pieces: the expansion badges, Back / Quit and the RCT3 logo ---------------------------------------------------
# Not part of the background pictures - each is its own widget, placed in code (GUI coordinates are y-up: a rect's y
# is its bottom edge, 0 at the bottom of the 1024 x 768 layout):
#  - badges (0xa4bc80): a loop over the expansions, AOP 1 (Wild, tiger) then AOP 0 (Soaked, shark), skipping ones not
#    installed. Each is a picture button (FrontScreen_AOPBadge_<n>, its icon's size) whose bottom-left corner is
#    (734, 527) + 475 x unit(turn((0.7, -1), a)), turn = (x cos a + y sin a, y cos a - x sin a), a += 0.28 per badge.
#    Hooked: the angle (fadd [0xf71cb0] at 0xa4be23) and both multiplies by 475 (0xa4be8e, 0xa4be9f) read a table by
#    the loop's AOP number, so each badge has its own place.
#  - Back (File_CareerMap) and Quit (File_Quit): type-4 buttons, slots 4 and 5 of the arc 0xa45670 places round
#    (734, 527), which the scenario-end menu (type 4, slots 0-5) shares. They are moved to slots 6 and 7 (the slot
#    pushes of their add calls and of the resize pass) and angle() / r() answer those two from a table: angle's jump-table entry for
#    type 4 (0xa452d0) and r's (0xa45170) point at stubs; r() has no slot argument, so its stub reads it from the
#    caller's frame, known by the return address (0xa47190 and 0xa457a0, as the menus' stubs do).
#  - RCT3 logo (0xa46028): x = 0 x sx (fmul [0xf264e0]), top = 750 x sy (fmul [0xf8dba0]); both multiplies are
#    pointed at numbers of our own.
# The kids picture (FrontEndLogo) is laid out from the window and the other pieces' sizes (0xa55c80), with no number
# of its own to change.
PIECES = CAVE + MENUS_SPACE                     # 0xf25e80 .. the end of .text's file space (0xf26000)
PMAGIC = b'RCT3OVL PIECES1\x00'
P_BANG, P_BRAD, P_CANG, P_CRAD, P_LOGO = PIECES + 0x10, PIECES + 0x18, PIECES + 0x20, PIECES + 0x28, PIECES + 0x30
BADGE_CENTRE, BADGE_V0, BADGE_R0, BADGE_STEP0 = (734.0, 527.0), (0.7, -1.0), 475.0, 0.28
B_FADD, B_FMUL1, B_FMUL2 = 0xa4be23, 0xa4be8e, 0xa4be9f      # each 6 bytes (D8 05 / D8 0D addr)
B_ANGLE_C, B_R_C = 0xf71cb0, 0xf8e594
ANGLE_JT4, ANGLE_CASE4 = 0xa452d0, 0xa45264
R_JT4, R_CASE4 = 0xa45170, 0xa45144
# push imm8 of each button's slot: in its add call (0xa47190) and in the resize pass (0xa457a0); the game's slot, ours
CORNER_SLOT = {'back': ((0xa501c1, 0xa48a49), 4, 6), 'quit': ((0xa5020b, 0xa48ad4), 5, 7)}
LOGO_X_AT, LOGO_Y_AT, LOGO_X_C, LOGO_Y_C = 0xa46059, 0xa46063, 0xf264e0, 0xf8dba0
LAYOUT_H = 768.0


def _asm(at: int, parts: list) -> bytes:
    """Tiny assembler for the stubs: bytes, ('jmp', target), ('jae8' / 'jne8' / 'jmp8', label), ('label', name)."""
    def size(x):
        return len(x) if isinstance(x, bytes) else 5 if x[0] == 'jmp' else 0 if x[0] == 'label' else 2
    where, a = {}, at
    for x in parts:
        if not isinstance(x, bytes) and x[0] == 'label':
            where[x[1]] = a
        a += size(x)
    out, a = b'', at
    for x in parts:
        if isinstance(x, bytes):
            out += x
        elif x[0] == 'jmp':
            out += b'\xe9' + struct.pack('<I', _rel(a, x[1]))
        elif x[0] != 'label':
            d = where[x[1]] - (a + 2)
            assert -128 <= d < 128
            out += bytes([{'jae8': 0x73, 'jne8': 0x75, 'jmp8': 0xeb}[x[0]], d & 0xff])
        a += size(x)
    return out


def _u(v: int) -> bytes:
    return struct.pack('<I', v)


def _pieces_code() -> list[tuple[int, bytes]]:
    c = []
    a = PIECES + 0x40          # badge angle: a = table[AOP number] (instead of a += 0.28)
    c.append((a, _asm(a, [b'\x8b\x54\x24\x34', b'\xdd\xd8', b'\xd9\x04\x95' + _u(P_BANG), ('jmp', B_FADD + 6)])))
    a = PIECES + 0x58          # badge radius, the x and the y multiply (an argument is pushed by then: +4)
    c.append((a, _asm(a, [b'\x8b\x54\x24\x38', b'\xd8\x0c\x95' + _u(P_BRAD), ('jmp', B_FMUL1 + 6)])))
    a = PIECES + 0x70
    c.append((a, _asm(a, [b'\x8b\x54\x24\x38', b'\xd8\x0c\x95' + _u(P_BRAD), ('jmp', B_FMUL2 + 6)])))
    a = PIECES + 0x88          # angle(type 4, slot 6 / 7) = table (two zeros are on the FPU stack at the case)
    c.append((a, _asm(a, [b'\x8b\x44\x24\x08', b'\x83\xe8\x06', b'\x83\xf8\x02', ('jae8', 'g'), b'\xdd\xd8', b'\xdd\xd8',
                          b'\xd9\x04\x85' + _u(P_CANG), b'\xc2\x08\x00', ('label', 'g'), ('jmp', ANGLE_CASE4)])))
    a = PIECES + 0xb0          # r(type 4): the slot from the caller's frame
    c.append((a, _asm(a, [b'\x8b\x04\x24', b'\x3d' + _u(0xa4728a), ('jne8', 'n'), b'\x8b\x44\x24\x54', ('jmp8', 'c'),
                          ('label', 'n'), b'\x3d' + _u(0xa457b0), ('jne8', 'g'), b'\x8b\x44\x24\x20',
                          ('label', 'c'), b'\x83\xe8\x06', b'\x83\xf8\x02', ('jae8', 'g'),
                          b'\xd9\x04\x85' + _u(P_CRAD), b'\xc2\x04\x00', ('label', 'g'), ('jmp', R_CASE4)])))
    return c


def pieces_installed(d: bytes) -> bool:
    try:
        o = tx._exe_offset(d, PIECES)
    except ValueError:
        return False
    return bytes(d[o:o + 16]) == PMAGIC


def _check_pieces(d: bytes):
    def bad(what):
        raise ValueError(f'{EXE} is a version the front screen designer does not know ({what})')
    inst = pieces_installed(d)
    o = tx._exe_offset(d, PIECES)
    if not inst and any(d[o:o + 0x180]):
        bad('free space at the end of the code is in use')
    hooks = {B_FADD: (b'\xd8\x05' + _u(B_ANGLE_C), PIECES + 0x40), B_FMUL1: (b'\xd8\x0d' + _u(B_R_C), PIECES + 0x58),
             B_FMUL2: (b'\xd8\x0d' + _u(B_R_C), PIECES + 0x70)}
    for at, (orig, stub) in hooks.items():
        o = tx._exe_offset(d, at)
        if bytes(d[o:o + 6]) not in (orig, b'\xe9' + _u(_rel(at, stub)) + b'\x90'):
            bad(f'{at:#x}')
    if _u32(d, ANGLE_JT4) not in (ANGLE_CASE4, PIECES + 0x88) or _u32(d, R_JT4) not in (R_CASE4, PIECES + 0xb0):
        bad('jump tables')
    for ats, game, ours in CORNER_SLOT.values():
        for at in ats:
            o = tx._exe_offset(d, at)
            if d[o - 1] != 0x6a or d[o] not in (game, ours):
                bad(f'{at:#x}')
    for at, c, mine in ((LOGO_X_AT, LOGO_X_C, P_LOGO), (LOGO_Y_AT, LOGO_Y_C, P_LOGO + 4)):
        o = tx._exe_offset(d, at)
        if _u32(d, at) not in (c, mine) or bytes(d[o - 2:o]) != b'\xd8\x0d':
            bad(f'{at:#x}')


def _badge_sizes(lib) -> list[tuple[float, float]]:
    """Each badge's size: its icon's (the game sizes the button by it)."""
    rects = {g['name']: g['rect'] for g in tx.icons(lib, MAIN)}
    out = []
    for n in range(2):
        r = rects.get(f'FrontScreen_AOPBadge_{n}', [0, 0, 100, 100])
        out.append((float(abs(r[2] - r[0])), float(abs(r[3] - r[1]))))
    return out


def _turn(v, a):
    x, y = v
    return x * math.cos(a) + y * math.sin(a), y * math.cos(a) - x * math.sin(a)


def _badge_xy(a: float, r: float, size) -> list[float]:
    """Top-left of a badge (1024 x 768, y down) from its angle and distance."""
    x, y = _turn(BADGE_V0, a)
    k = r / math.hypot(x, y)
    left, bottom = BADGE_CENTRE[0] + k * x, BADGE_CENTRE[1] + k * y
    return [round(left, 2), round(LAYOUT_H - bottom - size[1], 2)]


def _badge_ar(xy, size) -> tuple[float, float]:
    ox, oy = xy[0] - BADGE_CENTRE[0], LAYOUT_H - xy[1] - size[1] - BADGE_CENTRE[1]
    r = max(math.hypot(ox, oy), 0.5)
    a = math.atan2(BADGE_V0[1], BADGE_V0[0]) - math.atan2(oy, ox)
    return math.remainder(a, 2 * math.pi), r


def _corner_xy(a: float, r: float) -> list[float]:
    return [round(CENTRE[0] + r * math.cos(a), 2), round(CENTRE[1] - r * math.sin(a), 2)]


def _corner_ar(xy) -> tuple[float, float]:
    dx, dy = xy[0] - CENTRE[0], CENTRE[1] - xy[1]
    return math.atan2(dy, dx), max(math.hypot(dx, dy), 0.5)


def _game_pieces(lib, d: bytes, sizes) -> dict:
    """Where the game puts them with its own numbers (the corner arc as it is now)."""
    get = lambda k: _f32(d, struct.unpack_from('<I', d, tx._exe_offset(d, PARAMS[k][2][0]) + 2)[0])   # noqa: E731
    r = get('corner_r')
    return {'badges': [_badge_xy(BADGE_STEP0 * 2, BADGE_R0, sizes[0]), _badge_xy(BADGE_STEP0, BADGE_R0, sizes[1])],
            'corners': {k: _corner_xy(get('corner_start') + get('corner_step') * game, r)
                        for k, (_, game, _o) in CORNER_SLOT.items()},
            'logo': [0.0, LAYOUT_H - 750.0]}


def pieces(lib, d: bytes | None = None) -> dict:
    """The badges' top-left corners, Back / Quit's centres and the logo's top-left (1024 x 768, y down)."""
    if d is None:
        _, d = _exe(lib)
    _check_pieces(d)
    sizes = _badge_sizes(lib)
    game = _game_pieces(lib, d, sizes)
    if not pieces_installed(d):
        return {'installed': False, **game, 'game': game, 'badge_sizes': sizes}
    return {'installed': True, 'game': game, 'badge_sizes': sizes,
            'badges': [_badge_xy(_f32(d, P_BANG + 4 * n), _f32(d, P_BRAD + 4 * n), sizes[n]) for n in range(2)],
            'corners': {k: _corner_xy(_f32(d, P_CANG + 4 * (ours - 6)), _f32(d, P_CRAD + 4 * (ours - 6)))
                        for k, (_, _g, ours) in CORNER_SLOT.items()},
            'logo': [round(_f32(d, P_LOGO), 2), round(LAYOUT_H - _f32(d, P_LOGO + 4), 2)]}


def _pieces_uninstall() -> list[dict]:
    p = [{'va': PIECES, 'hex': '00' * 0x180},
         {'va': B_FADD, 'hex': 'd805' + _u(B_ANGLE_C).hex()}, {'va': B_FMUL1, 'hex': 'd80d' + _u(B_R_C).hex()},
         {'va': B_FMUL2, 'hex': 'd80d' + _u(B_R_C).hex()}, {'va': ANGLE_JT4, 'u32': ANGLE_CASE4}, {'va': R_JT4, 'u32': R_CASE4},
         {'va': LOGO_X_AT, 'u32': LOGO_X_C}, {'va': LOGO_Y_AT, 'u32': LOGO_Y_C}]
    p += [{'va': at, 'hex': f'{game:02x}'} for ats, game, _o in CORNER_SLOT.values() for at in ats]
    return p


def set_pieces(lib, badges: list | None = None, corners: dict | None = None, logo: list | None = None) -> dict:
    """badges: 2 top-left [x, y] (Soaked, Wild); corners: {'back' | 'quit': centre [x, y]}; logo: top-left [x, y].
    Missing ones keep where they are now. Writes the stubs and hooks the first time."""
    _, d = _exe(lib)
    _check(d)
    _check_menus(d)
    _check_pieces(d)
    cur = pieces(lib, d)
    badges = badges if badges is not None else cur['badges']
    corners = {**cur['corners'], **(corners or {})}
    logo = logo if logo is not None else cur['logo']
    sizes = cur['badge_sizes']
    if len(badges) != 2 or set(corners) != set(CORNER_SLOT):
        raise ValueError('2 badges and Back / Quit are needed')
    for what, (x, y) in [('badge', b) for b in badges] + list(corners.items()) + [('logo', logo)]:
        if not (-300 <= float(x) <= 1324 and -300 <= float(y) <= 1068):
            raise ValueError(f'{what} ({float(x):.0f}, {float(y):.0f}) is off the screen')
    p = []
    if not pieces_installed(d):
        p.append({'va': PIECES, 'hex': PMAGIC.hex()})
        p += [{'va': a, 'hex': b.hex()} for a, b in _pieces_code()]
        p += [{'va': B_FADD, 'hex': 'e9' + _u(_rel(B_FADD, PIECES + 0x40)).hex() + '90'},
              {'va': B_FMUL1, 'hex': 'e9' + _u(_rel(B_FMUL1, PIECES + 0x58)).hex() + '90'},
              {'va': B_FMUL2, 'hex': 'e9' + _u(_rel(B_FMUL2, PIECES + 0x70)).hex() + '90'},
              {'va': ANGLE_JT4, 'u32': PIECES + 0x88}, {'va': R_JT4, 'u32': PIECES + 0xb0},
              {'va': LOGO_X_AT, 'u32': P_LOGO}, {'va': LOGO_Y_AT, 'u32': P_LOGO + 4}]
        p += [{'va': at, 'hex': f'{ours:02x}'} for ats, _g, ours in CORNER_SLOT.values() for at in ats]
        p.append({'off': _text_vsize_off(d), 'u32': 0xb25000})
    for n, xy in enumerate(badges):
        a, r = _badge_ar([float(v) for v in xy], sizes[n])
        p += [{'va': P_BANG + 4 * n, 'f32': a}, {'va': P_BRAD + 4 * n, 'f32': r}]
    for k, (_, _g, ours) in CORNER_SLOT.items():
        a, r = _corner_ar([float(v) for v in corners[k]])
        p += [{'va': P_CANG + 4 * (ours - 6), 'f32': a}, {'va': P_CRAD + 4 * (ours - 6), 'f32': r}]
    p += [{'va': P_LOGO, 'f32': float(logo[0])}, {'va': P_LOGO + 4, 'f32': LAYOUT_H - float(logo[1])}]
    tx.patch_exe(lib, EXE, p, 'Front screen layout')
    return layout(lib)


def reset_pieces(lib) -> dict:
    _, d = _exe(lib)
    _check_pieces(d)
    if pieces_installed(d):
        vs = [] if menus_installed(d) else [{'off': _text_vsize_off(d), 'u32': TEXT_VSIZE}]
        tx.patch_exe(lib, EXE, _pieces_uninstall() + vs, 'Front screen layout')
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
    out = set_layout(lib, th['layout'], th['colour'])
    if out['menus']['installed']:          # the places would hide the theme's arc: put them on it
        out = set_menus(lib, out['menus']['arc_places'], out['menus']['menus'])
    return out
