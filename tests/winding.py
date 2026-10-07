"""Winding check: do glTF triangle face normals agree with the stored vertex normals? (1.0 = all front faces
point outwards; near 0.0 = winding reversed, so a viewer with back-face culling shows the model inside out.)

usage: python tests/winding.py "<game folder>"
"""
import json
import struct
import sys

import numpy as np

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl.characters import build_person  # noqa: E402
from rct3ovl.export import export_resource  # noqa: E402
from rct3ovl.library import Library  # noqa: E402


def check(glb: bytes, label: str):
    jl = struct.unpack_from('<I', glb, 12)[0]
    g = json.loads(glb[20:20 + jl]); b = glb[20 + jl + 8:]

    def acc(i):
        a = g['accessors'][i]; v = g['bufferViews'][a['bufferView']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
        dt = {5126: '<f4', 5121: 'u1', 5123: '<u2', 5125: '<u4'}[a['componentType']]
        return np.frombuffer(b, dt, a['count'] * n, v.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(a['count'], n)

    out = []
    for m in g['meshes']:
        for p in m['primitives']:
            if 'NORMAL' not in p['attributes']:
                continue
            P = acc(p['attributes']['POSITION']); N = acc(p['attributes']['NORMAL'])
            t = acc(p['indices']).reshape(-1, 3).astype(int)
            fn = np.cross(P[t[:, 1]] - P[t[:, 0]], P[t[:, 2]] - P[t[:, 0]])
            agree = float((np.einsum('ij,ij->i', fn, N[t].mean(1)) > 0).mean())
            ds = g['materials'][p['material']].get('doubleSided', False) if 'material' in p else False
            out.append(agree)
            print(f'{label:24} {m["name"][:28]:28} agree {agree:.2f}  doubleSided={ds}')
    return out


if __name__ == '__main__':
    lib = Library(sys.argv[1])
    h = lib.find('ss_body_jpop01_l1:mms')
    check(export_resource(lib, h[0], None, h[1], ['IdleStandard'])[0][0][2], 'mms JPOP01 swimsuit')
    h = lib.find('body_d01_l1:mms')
    check(export_resource(lib, h[0], None, h[1], ['5StandIdle'])[0][0][2], 'mms duck')
    check(build_person(lib, 'af01', ['Walk'])[0], 'person AF01')
    o, ts = lib.open(r'Cars\CoasterCars\MineRide\MineRide')
    r = next(x for x in o.by_tag('bsh'))
    check(export_resource(lib, o, ts, r, [])[0][0][2], 'bsh mine cart (good)')
