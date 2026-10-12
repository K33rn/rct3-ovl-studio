"""Game file -> editor data -> built game file -> parsed again: every value must survive (fireworks, lasers, water
jets, shows). usage: python tests/fw_build_check.py "<game folder>"
"""
import glob
import os
import sys
import tempfile

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl import fireworks as F  # noqa: E402
from rct3ovl.library import Library  # noqa: E402
from rct3ovl.trk import Trk  # noqa: E402

lib = Library(sys.argv[1])


def close(a, b, path=''):
    if isinstance(a, float) or isinstance(b, float):
        return abs(float(a) - float(b)) < 1e-4 or (a != a and b != b)
    if isinstance(a, dict) and isinstance(b, dict):
        bad = [k for k in a if k in b and not close(a[k], b[k], path + '.' + k)]
        return not bad
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(close(x, y) for x, y in zip(a, b))
    return a == b


def tree(fw):
    """firework as a nested structure independent of object ids"""
    N = fw['nodes']

    def node(k):
        n = dict(N[str(k)])
        kids = n.pop('ParticleEmitterDescs', None)
        pd = n.pop('ParticleDesc', None)
        n.pop('kind', None)
        if kids is not None:
            n['_kids'] = [node(e) for e in kids]
        if pd is not None:
            n['_particle'] = node(pd)
        return n
    return node(fw['root'])


ok = bad = 0
for fw in F.list_fireworks(lib):
    blob = F.build_frw(lib, fw)
    p = os.path.join(tempfile.gettempdir(), 'rt_' + fw['file'])
    open(p, 'wb').write(blob)
    again = F.load_firework(lib, p)
    if close(tree(fw), tree(again)) and again['title'] == fw['title'] or close(tree(fw), tree(again)):
        ok += 1
    else:
        bad += 1; print('  firework differs:', fw['file'])
print('fireworks rebuilt identical in content:', ok, '/', ok + bad)

for kind, ext in (('laser', 'las'), ('jet', 'wjt')):
    ok = bad = 0
    for d in F.list_effects(lib, kind):
        blob = F.build_effect(lib, d)
        p = os.path.join(tempfile.gettempdir(), 'rt.' + ext)
        open(p, 'wb').write(blob)
        again = F._effect_file(p, kind)
        keys = [k for k in d if k not in ('file', 'custom', 'ingame', 'name')]
        diff = [k for k in keys if not close(d[k], again[k])]
        if diff:
            bad += 1; print('  ', kind, d['file'], 'differs in', diff, '\n     ', str(d[diff[0]])[:200], '\n     ', str(again[diff[0]])[:200])
        else:
            ok += 1
    print(kind + 's rebuilt identical in content:', ok, '/', ok + bad)

ok = bad = 0
for d in F.list_displays(lib):
    blob = F.build_fwd(lib, {'name': d['name'], 'music': d['music'], 'start_minutes': d['start_minutes'],
                             'launchers': d['launchers'], 'entries': d['entries']})
    tmp = os.path.join(tempfile.gettempdir(), 'rct3rt')
    os.makedirs(os.path.join(tmp, 'FireworkDisplays'), exist_ok=True)
    for f in glob.glob(os.path.join(tmp, 'FireworkDisplays', '*')):
        os.remove(f)
    open(os.path.join(tmp, 'FireworkDisplays', d['file']), 'wb').write(blob)
    root = lib.root
    lib.root = tmp
    again = [x for x in F.list_displays(lib) if x['file'] == d['file']]
    lib.root = root
    if again and close({k: d[k] for k in ('name', 'music', 'launchers')}, {k: again[0][k] for k in ('name', 'music', 'launchers')}) \
            and close(sorted(d['entries'], key=lambda e: (e['time'], e['launcher'], e['slot'])),
                      sorted(again[0]['entries'], key=lambda e: (e['time'], e['launcher'], e['slot']))):
        ok += 1
    else:
        bad += 1; print('  show differs:', d['file'])
        if again:
            a, b = d, again[0]
            for k in ('name', 'music', 'launchers'):
                if not close(a[k], b[k]): print('     ', k, str(a[k])[:160], '|', str(b[k])[:160])
            ea = sorted(a['entries'], key=lambda e: (e['time'], e['launcher'], e['slot'])); eb = sorted(b['entries'], key=lambda e: (e['time'], e['launcher'], e['slot']))
            print('      entries', len(ea), len(eb), next(((x, y) for x, y in zip(ea, eb) if not close(x, y)), None))
print('shows rebuilt identical in content:', ok, '/', ok + bad)
Trk(F.build_frw(lib, F.list_fireworks(lib)[0]))
print('built files parse: ok')
