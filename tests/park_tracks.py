"""Every tracked ride in every park save: is each track piece joined to the next (the worst joint per ride)?
usage: python tests/park_tracks.py "<game folder>" [park name filter]
"""
import sys

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
import rct3ovl.designs as D  # noqa: E402
from rct3ovl import parks as P  # noqa: E402
from rct3ovl.library import Library  # noqa: E402

lib = Library(sys.argv[1])
want = sys.argv[2].lower() if len(sys.argv) > 2 else ''
seen = []
orig = D.lay_track


def spy(*a, **k):
    out = orig(*a, **k)
    seen.append(out[0].joints)
    return out


P.lay_track = spy
rides = bad = 0
for park in P.list_parks(lib):
    if want and want not in park['title'].lower():
        continue
    rel = park['file']
    w = P.park_world(lib, rel)
    for t in w.get('tracks', []):
        seen.clear()
        try:
            _glb, info = P._track_model(lib, rel, t['id'])
        except Exception as e:  # noqa: BLE001
            print(f"  {park['title']}: {t.get('name')} - {e}"); continue
        rides += 1
        js = seen[0] if seen else []
        worst = max((j[0] for j in js), default=0.0)
        if worst > 0.1:
            bad += 1
            print(f"  {park['title']}: {info['name']} ({info['type']}) worst joint {worst:.2f} m",
                  [(i, n, round(g, 2)) for g, i, n in js if g > 0.1][:6])
print('tracked rides', rides, '| with a joint over 10 cm:', bad)
