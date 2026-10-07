"""Bone animations (ban) and scenery visuals (svd), which tie models to their animations.

BoneAnim (12 B): bone count, bones*, total time. Bone (20 B): name*, translation count, translations*,
rotation count, rotations*. Key (16 B): time, x, y, z. Translations are the bone's local position; rotations are
local axis-angle vectors (axis * angle in radians). Both in RCT3's left-handed space.

SceneryItemVisual (svd): flags, sway, brightness, unk, scale, LOD count, LODs**, ... Each LOD (72 B): type
(0 static shs, 3 animated bsh, 4 billboard), name*, shs import, 0, bsh import, 0, ftx import, txs import,
6 billboard floats, distance, animation count, 0, animations** (ban imports).
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field

import numpy as np

from .container import LoaderRef, Ovl


@dataclass
class BoneTrack:
    name: str
    translations: np.ndarray       # (n, 4) time, x, y, z
    rotations: np.ndarray          # (m, 4) time, axis-angle xyz


@dataclass
class BoneAnimation:
    name: str
    duration: float
    bones: list[BoneTrack] = field(default_factory=list)


def load_ban(ovl: Ovl, ref: LoaderRef) -> BoneAnimation:
    o = ovl
    n, bones_p, total = struct.unpack('<IIf', o.read(ref.data, 12))
    anim = BoneAnimation(ref.name, total)
    for b in range(n):
        name_p, tc, tp, rc, rp = struct.unpack('<IIIII', o.read(bones_p + 20 * b, 20))
        tr = np.frombuffer(o.read(tp, 16 * tc), '<f4').reshape(tc, 4).copy() if tc else np.zeros((0, 4), np.float32)
        ro = np.frombuffer(o.read(rp, 16 * rc), '<f4').reshape(rc, 4).copy() if rc else np.zeros((0, 4), np.float32)
        anim.bones.append(BoneTrack(o.str_field(bones_p + 20 * b, f'bone{b}'), tr, ro))
    return anim


@dataclass
class VisualLOD:
    type: int                      # 0 static, 3 animated, 4 billboard
    name: str
    model: str                     # 'name:shs' / 'name:bsh' / billboard ftx
    distance: float
    animations: list[str] = field(default_factory=list)


@dataclass
class SceneryVisual:
    name: str
    flags: int
    sway: float
    brightness: float
    scale: float
    lods: list[VisualLOD] = field(default_factory=list)


def load_svd(ovl: Ovl, ref: LoaderRef) -> SceneryVisual:
    o = ovl
    imports = {site: nm for nm, site in o.symbol_refs}
    flags, sway, bright, _u, scale, nlod, lods_p = struct.unpack('<I4fII', o.read(ref.data, 28))
    sv = SceneryVisual(ref.name, flags, sway, bright, scale)
    for i in range(nlod):
        lp = o.ptr(lods_p + 4 * i)
        w = struct.unpack('<II6I7fIII', o.read(lp, 72))
        typ, name_p, dist, nanim, anims_p = w[0], w[1], w[14], w[15], w[17]
        model = imports.get(lp + 8) or imports.get(lp + 16) or imports.get(lp + 24) or ''
        anims = []
        if nanim and anims_p:
            for a in range(nanim):
                arr = o.ptr(anims_p + 4 * a)            # BoneAnim** -> pointer to a slot holding the import
                anims.append(imports.get(arr, imports.get(anims_p + 4 * a, '')))
        sv.lods.append(VisualLOD(typ, o.str_field(lp + 4), model, dist, [a for a in anims if a]))
    return sv


def axis_angle_to_matrix(v: np.ndarray) -> np.ndarray:
    ang = float(np.linalg.norm(v))
    if ang < 1e-9:
        return np.eye(3)
    k = v / ang; K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(ang) * K + (1 - np.cos(ang)) * K @ K
