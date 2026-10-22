"""Mod Loader placement rules, on made-up downloads (no game needed):
- a set goes where its own Style.ovl names its OVLs (VTR Twister: Style\\Custom\\VTR\\Twister, not Style\\Themed);
- 'Place the 'SpeedFlip' folder in the 'Zodi' folder' -> Style\\Custom\\Zodi\\SpeedFlip;
- pictures a park names by path (My Pictures\\RCT3\\Expo 3000\\Floor.jpg) are found in the save;
- a custom flat ride whose model box is its own size gets the tall box the game needs to draw it placed;
- unpack paths stay short and long ones get the \\\\?\\ form.
usage: python tests/mods_rules.py"""
import os
import sys
import tempfile

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl import mods  # noqa: E402

problems = []


def check(what, got, want):
    print(f'{what}: {got!r}')
    if got != want:
        problems.append(f'{what}: {got!r}, wanted {want!r}')


with tempfile.TemporaryDirectory() as t:
    ride = os.path.join(t, 'VTR Twister', 'Twister')
    os.makedirs(ride)
    open(os.path.join(ride, 'Style.common.ovl'), 'wb').write(b'\0junk\0Style\\Custom\\VTR\\Twister\\Twister\0Twister-Twister:svd\0')
    open(os.path.join(ride, 'Twister.common.ovl'), 'wb').write(b'')
    check('ride home', mods._style_home(ride), 'Style/Custom/VTR/Twister')
    cso = os.path.join(t, 'VTR Twister', 'VTRTwister Verkleidung')
    os.makedirs(os.path.join(cso, 'CFR Verkleidung'))
    open(os.path.join(cso, 'style.common.ovl'), 'wb').write(
        b'Style\\Themed\\VTRTwister Verkleidung\\CFR Verkleidung\\VTRTwister Verkleidung\0')
    open(os.path.join(cso, 'CFR Verkleidung', 'VTRTwister Verkleidung.common.ovl'), 'wb').write(b'')
    check('set with a model subfolder', mods._style_home(cso), 'Style/Themed/VTRTwister Verkleidung')
    other = os.path.join(t, 'Other')
    os.makedirs(other)
    open(os.path.join(other, 'Style.common.ovl'), 'wb').write(b'Style\\Themed\\Somewhere\\Else\0')
    check('Style.ovl naming none of its own OVLs', mods._style_home(other), None)

    park = os.path.join(t, 'park')
    os.makedirs(park)
    open(os.path.join(park, 'Expo.dat'), 'wb').write(b'\1\2' + 'C:\\My Pictures\\RCT3\\Expo 3000\\Floor.jpg'.encode('utf-16le') + b'\0\0')
    check('pictures a park names', mods._picture_refs(park), {'floor.jpg': 'Expo 3000/Floor.jpg'})

check('readme: folder into an author folder', mods._readme_folders("Place the 'SpeedFlip' folder in the 'Zodi' folder."),
      {'speedflip': 'Custom/Zodi'})
check('readme: folder into Style/Custom', mods._readme_folders('Put "CFH-Rides" inside your Style/Custom folder'),
      {'cfh-rides': 'Custom'})
# a custom flat ride with a model box its own size gets the tall box (the real VTR Twister download, when it is here)
twz = os.path.join(os.path.expanduser('~'), 'Downloads', 'VTR Twister.zip')
if os.path.exists(twz):
    with tempfile.TemporaryDirectory() as t:
        mods.extract(twz, t)
        d = next(dp for dp, dn, fn in os.walk(t) if 'Twister.common.ovl' in fn)
        before = {f: open(os.path.join(d, f), 'rb').read() for f in os.listdir(d)}
        check('flat ride with a short box', [m['model'] for m in mods.flat_ride_boxes(d)], ['Twister-Twister5a:bsh'])
        check('fixed', mods.fix_flat_rides(d), ['Twister-Twister5a:bsh'])
        diff = {}
        for f, b in before.items():
            a = open(os.path.join(d, f), 'rb').read()
            diff[f] = [i for i in range(len(b)) if a[i] != b[i]] if len(a) == len(b) else None
        changed = {f: x for f, x in diff.items() if x != []}
        # the box (6 floats) is in the bsh's data: here Twister.unique.ovl; only y min / y max change
        check('only the box height changed', {f: (len(x), x[-1] - x[0] < 16) for f, x in changed.items()}, {'Twister.unique.ovl': (8, True)})
        check('nothing left to fix', mods.flat_ride_boxes(d), [])
        cso = next(dp for dp, dn, fn in os.walk(t) if 'VTRTwister Verkleidung.common.ovl' in fn)
        check('scenery set without a flat ride left alone', mods.flat_ride_boxes(os.path.dirname(cso)), [])
else:
    print('(VTR Twister.zip not in Downloads: flat ride box check skipped)')
check('long path form', mods._long('C:\\' + 'a' * 250).startswith('\\\\?\\'), os.name == 'nt')
check('short path left alone', mods._long('C:\\short'), 'C:\\short')
print('problems:', problems or 'none')
sys.exit(1 if problems else 0)
