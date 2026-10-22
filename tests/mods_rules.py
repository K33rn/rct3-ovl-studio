"""Mod Loader placement rules, on made-up downloads (no game needed):
- a set goes where its own Style.ovl names its OVLs (VTR Twister: Style\\Custom\\VTR\\Twister, not Style\\Themed);
- 'Place the 'SpeedFlip' folder in the 'Zodi' folder' -> Style\\Custom\\Zodi\\SpeedFlip;
- pictures a park names by path (My Pictures\\RCT3\\Expo 3000\\Floor.jpg) are found in the save;
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
check('long path form', mods._long('C:\\' + 'a' * 250).startswith('\\\\?\\'), os.name == 'nt')
check('short path left alone', mods._long('C:\\short'), 'C:\\short')
print('problems:', problems or 'none')
sys.exit(1 if problems else 0)
