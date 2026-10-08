"""Survey all scenery items (sid): type x top folder, visual/model resolution, animations.
usage: python tests/sid_survey.py "<game folder>"
"""
import collections
import sys
import time

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl.anims import load_svd  # noqa: E402
from rct3ovl.library import Library  # noqa: E402
from rct3ovl.structs import load_sid  # noqa: E402

lib = Library(sys.argv[1])
t0 = time.time()
names = lib.index['names']
sids = sorted(k for k in names if k.endswith(':sid'))
print(len(sids), 'sid names')
tally = collections.Counter(); folders = collections.Counter(); ok = collections.Counter(); anim = collections.Counter()
ex = collections.defaultdict(list)
for n in sids:
    h = lib.find(n)
    if not h:
        continue
    try:
        d = load_sid(h[0], h[1])
    except Exception as e:
        tally['ERR'] += 1; continue
    rel = names[n].replace('\\', '/').split('/')
    top = '/'.join(rel[:3]) if rel[0].lower() == 'style' else '/'.join(rel[:2])
    typ = str(d['type'])
    tally[typ] += 1; folders[(typ, top)] += 1
    vis = [v for v in d['visuals'] if v]
    m = None
    for v in vis:
        hv = lib.find_near(v, h[0])
        if hv:
            lods = [l for l in load_svd(hv[0], hv[1]).lods if l.model.lower().endswith((':shs', ':bsh'))]
            if lods:
                m = lods[0]; break
    if m:
        ok[typ] += 1
        if m.animations:
            anim[typ] += 1
    if len(ex[typ]) < 4:
        ex[typ].append((n, d['display_name'], names[n]))
print('types:', tally.most_common())
print('with model:', ok.most_common())
print('animated:', anim.most_common())
for (typ, top), c in sorted(folders.items(), key=lambda x: -x[1])[:45]:
    print(f'  {typ:14} {top:50} {c}')
for typ, e in ex.items():
    print(typ, e[:3])
print(round(time.time() - t0), 's')
