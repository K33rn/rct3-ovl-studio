"""Front-screen pieces (badges, Back / Quit, logo) written into a scratch copy of RCT3plus.exe: the game's places, set
and read back, the stubs disassembled, menus on top and off, reset byte-identical. usage: front_pieces_exe.py <folder with a copy of RCT3plus.exe> x"""
import os, sys, struct, hashlib, types
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from rct3ovl import frontscreen as fs, texedit as tx
folder, game = sys.argv[1], sys.argv[2]
md5 = lambda: hashlib.md5(open(os.path.join(folder, 'RCT3plus.exe'), 'rb').read()).hexdigest()
lib = types.SimpleNamespace(root=folder)
tx.icons = (lambda real: (lambda l, rel: [{'name': 'FrontScreen_AOPBadge_0', 'rect': [320, 0, 420, 100]}, {'name': 'FrontScreen_AOPBadge_1', 'rect': [320, 100, 420, 200]}]))(tx.icons)
tx._backup_dir = lambda l: os.path.join(folder, 'bk')
tx.edits = lambda l: {}
tx._save_edits = lambda l, e: None
m0 = md5()
p = fs.pieces(lib)
print('game:', p['badges'], p['corners'], p['logo'])
assert abs(p['badges'][1][0] - 888.6) < 2 and abs(p['badges'][0][0] - 758) < 3, p['badges']
r = fs.set_pieces(lib, p['badges'], p['corners'], p['logo'])     # same places through the tables
q = r['pieces']
for a, b in zip(q['badges'] + list(q['corners'].values()) + [q['logo']], p['badges'] + list(p['corners'].values()) + [p['logo']]):
    assert max(abs(a[0] - b[0]), abs(a[1] - b[1])) < 0.05, (a, b)
print('same places through the tables: ok', q['installed'])
r = fs.set_pieces(lib, [[100, 200], [300, 400]], {'back': [50, 700], 'quit': [90, 720]}, [20, 40])['pieces']
print('moved:', r['badges'], r['corners'], r['logo'])
assert abs(r['badges'][0][0] - 100) < 0.05 and abs(r['corners']['quit'][1] - 720) < 0.05 and r['logo'] == [20.0, 40.0]
# menus on top of the pieces and off again: the pieces stay
L = fs.layout(lib); fs.set_menus(lib, L['menus']['arc_places'], L['menus']['menus'])
assert fs.pieces(lib)['badges'][0][0] - 100 < 0.05 and fs.menus_installed(open(os.path.join(folder, 'RCT3plus.exe'), 'rb').read())
fs.reset_menus(lib); assert fs.pieces(lib)['installed']
d = open(os.path.join(folder, 'RCT3plus.exe'), 'rb').read()
print('vsize', hex(struct.unpack_from('<I', d, fs._text_vsize_off(d))[0]))
from capstone import Cs, CS_ARCH_X86, CS_MODE_32
md = Cs(CS_ARCH_X86, CS_MODE_32)
for a, b in fs._pieces_code():
    print('--', hex(a))
    for i in md.disasm(b, a): print(f'  {i.address:x} {i.mnemonic} {i.op_str}')
for at in (fs.B_FADD, fs.B_FMUL1, fs.B_FMUL2):
    o = tx._exe_offset(d, at); print(hex(at), [f'{i.mnemonic} {i.op_str}' for i in md.disasm(d[o:o + 6], at)])
try:
    fs.set_pieces(lib, [[5000, 0], [0, 0]]); print('BAD: off screen accepted')
except ValueError as e: print('refused:', e)
fs.reset_pieces(lib)
print('reset byte-identical:', md5() == m0)
assert md5() == m0
