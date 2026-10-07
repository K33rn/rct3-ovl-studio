"""One place that turns any resource into files. Used by the CLI extractor and the viewer."""
from __future__ import annotations

import io
import json
import os
import re

from .anims import load_ban, load_svd
from .container import LoaderRef, Ovl
from .gltf import shape_to_glb, texture_note
from .gltf_people import people_to_glb
from .library import Library
from .media import sound_info, sound_wav, text
from .mdl import load_mdl
from .meshes import load_shape
from .morph import load_morph
from .people import load_phd, load_ppg, load_prt, load_sal, load_san, load_ssk
from .structs import describe, gsi_image, load_gsi, load_sid, load_spline, spline_points

# what each tag becomes
KIND = {'tex': 'texture', 'ftx': 'texture', 'gsi': 'icon', 'shs': 'model', 'bsh': 'model', 'mms': 'morph',
        'ssk': 'head', 'snd': 'sound', 'txt': 'text', 'spl': 'spline'}


def _png(img) -> bytes:
    b = io.BytesIO(); img.save(b, 'PNG'); return b.getvalue()


def _js(obj) -> bytes:
    return json.dumps(obj, indent=1, default=lambda x: x.tolist() if hasattr(x, 'tolist') else str(x)).encode()


def safe(name: str) -> str:
    return ''.join(c if c.isalnum() or c in '-_.' else '_' for c in name) or 'unnamed'


_HEAD = re.compile(r'^(ss_)?head_([a-z0-9]+)_l(\d)')


def head_clips(lib: Library, o: Ovl, skin_name: str) -> dict:
    """san clips for a simple skin, first match wins:
    1. in the skin's own OVL, named after it (staff: SS_Head_LG01_L1_LifeGuardIdle01);
    2. [ss_]head_<variant>_l<n>_<anim> for this detail level, then the other levels (the pop star's L2 heads have no
       clips of their own; L1's fit, same bones), with and without the ss_ prefix."""
    base = skin_name.split(':')[0]
    clips = {}
    for r in o.by_tag('san'):
        if r.name.lower().startswith(base.lower()):
            for c in load_san(o, r):
                clips[c.name[len(base):].lstrip('_') or c.name] = c
    m = _HEAD.match(base.lower())
    if not clips and m:
        ss, v, lod = m.group(1) or '', m.group(2), int(m.group(3))
        prefixes = []
        for pre in (ss, '') if ss else ('',):
            for level in [lod] + [k for k in (1, 2, 3) if k != lod]:
                prefixes.append(f'{pre}head_{v}_l{level}_')
        names = lib.index['names']
        for prefix in prefixes:
            for n in names:
                if n.startswith(prefix) and n.endswith(':san'):
                    h = lib.find(n)
                    cl = load_san(h[0], h[1]) if h else []
                    if cl:
                        clips[n[len(prefix):-4]] = cl[0]
            if clips:
                break
    return clips


def neutral_head_pose(lib: Library, nbones: int) -> dict:
    """Last resort for a head without any animations: a standing pose from a guest head with the same bone count,
    so the head is upright instead of lying in bone-local space."""
    for n in ('head_af01_l1_idle1:san', 'head_am01_l1_idle1:san', 'head_af01_l1_walk:san'):
        h = lib.find(n)
        for c in (load_san(h[0], h[1]) if h else []):
            if c.positions.shape[1] == nbones:
                return {'pose': c}
    return {}


def head_texture(lib: Library, o: Ovl, skin_name: str) -> str | None:
    """The texture of a skinned head = the texture of the character's head part (prt). Names can clash between
    characters (the pop star's SS_Head_VF01 vs the vendor VF01), so parts in the head's own folder win."""
    m = _HEAD.match(skin_name.split(':')[0].lower())
    if not m:
        return None
    ss, v, lod = m.group(1) or '', m.group(2), m.group(3)
    cands = [f'{ss}head_{v}_l{lod}', f'head_{v}_l{lod}', f'head_{v}_l3', f'ss_head_{v}_l3', f'head_{v}_l1', f'head_{v}_l2']
    folder = os.path.dirname(os.path.relpath(o.files[0].path, lib.root)).lower()
    names = lib.index['names']
    same = [n for n in names if n.endswith(':prt') and (n.startswith('head_') or n.startswith('ss_head_'))
            and os.path.dirname(names[n]).lower() == folder]
    order = [c + ':prt' for c in cands if c + ':prt' in same] + same + [c + ':prt' for c in cands]
    for pn in order:
        h = lib.find(pn)
        for e in (load_prt(h[0], h[1]) if h else []):
            if e.texture:
                return e.texture
    return None


def export_resource(lib: Library, o: Ovl, ts, r: LoaderRef, anims=None, max_morph_anims: int = 12,
                    variant: int | None = 0) -> tuple[list, dict]:
    """-> ([(subfolder, filename, bytes)], info). anims: animation names to include (None = all / default).
    variant: colour variant tile for people/animal textures (0 = top-left; None = as stored)."""
    tag, base = r.loader.tag, safe(r.name.split(':')[0] or hex(r.data))
    files, info = [], {}
    if tag in ('tex', 'ftx'):
        img = ts.image(r)
        if img is not None:
            files.append(('textures', f'{base}.{tag}.png', _png(img)))
            info['size'] = list(img.size)
            if tag == 'ftx':
                info['recolourable'] = ts.recolorable(r); info['frames'] = ts.frame_count(r)
    elif tag == 'gsi':
        img = gsi_image(lib, o, r)
        info.update(load_gsi(o, r))
        if img is not None:
            files.append(('icons', f'{base}.png', _png(img)))
    elif tag == 'mdl':
        s = load_mdl(o, r)
        files.append(('models', f'{base}.mdl.glb', shape_to_glb(s, lambda n: lib.texture_image(n, prefer=o))))
        info.update({'textures': sorted({m.texture for m in s.meshes if m.texture}), 'bones': getattr(s, 'bone_names', []),
                     'note': 'Wild! model; shown in its standing pose (its walk/run animations are not decoded yet)'})
        info['missing_textures'] = {t: n for t in info['textures']
                                    if (n := texture_note(t, t.lower() in lib.index['names']))}
    elif tag in ('shs', 'bsh'):
        s = load_shape(o, r)
        an = lib.animations_for(o, s) if tag == 'bsh' else []
        if anims is not None:
            an = [a for a in an if a.name.split(':')[0] in anims]
        files.append(('models', f'{base}.{tag}.glb', shape_to_glb(s, lambda n: lib.texture_image(n, prefer=o), an)))
        info.update({'textures': sorted({m.texture for m in s.meshes}), 'bones': len(s.bones),
                     'animations': [a.name for a in an], 'attach_points': [e[0] for e in s.effects]})
        notes = {t: texture_note(t, t.lower() in lib.index['names']) for t in info['textures'] if t}
        info['missing_textures'] = {t: n for t, n in notes.items() if n}
    elif tag == 'mms':
        mm = load_morph(o, r)
        names = [a.name for a in mm.anims]
        sel = [n for n in names if anims is None or n in anims] or names[:1]
        if anims is None:
            sel = sel[:max_morph_anims]
        tex = None
        for p in o.by_tag('prt'):                        # texture comes from the person part that uses this mesh
            for e in load_prt(o, p):
                if e.mesh == r.name:
                    tex = e.texture
        if tex is None:
            # animals (duck, seagull, fish…) have no person part: their texture sits in the same OVL
            cands = [x.name for x in o.by_tag('tex')] or [x.name for x in o.by_tag('ftx')]
            stem = os.path.basename(o.name).split('.')[0].lower()
            tex = next((c for c in cands if c.split(':')[0].lower() == stem), cands[0] if cands else None)
        img = lib.texture_image(tex, prefer=o) if tex else None
        info['variants'] = mm.variant_count(img)
        mm = mm.with_variant(variant, img)
        files.append(('morphs', f'{base}.mms.glb', people_to_glb([(mm, img)], (), sel, base)))
        info.update({'animations': names, 'exported_animations': sel, 'texture': tex or ''})
    elif tag == 'ssk':
        sk = load_ssk(o, r)
        clips = head_clips(lib, o, r.name)
        clips = dict(sorted(clips.items(), key=lambda kv: (kv[0].lower() not in ('walk', 'idle'), kv[0])))
        if anims is not None:
            clips = {k: v for k, v in clips.items() if k in anims} or dict(list(clips.items())[:1])
        elif len(clips) > max_morph_anims:
            clips = dict(list(clips.items())[:max_morph_anims])
        if not clips:
            clips = neutral_head_pose(lib, len(sk.bones))
            info['note'] = 'no animations of its own; shown in a neutral pose'
        tex = head_texture(lib, o, r.name)
        files.append(('heads', f'{base}.ssk.glb', people_to_glb([], [(sk, clips, lib.texture_image(tex, prefer=o) if tex else None)],
                                                                  None, base)))
        info.update({'bones': sk.bones, 'animations': [k for k in clips if k != 'pose'], 'texture': tex or ''})
    elif tag == 'snd':
        files.append(('sounds', f'{base}.wav', sound_wav(o, r)))
        i = sound_info(o, r); info.update({k: i[k] for k in ('channels', 'rate', 'bits', 'loop')})
    elif tag == 'txt':
        info['text'] = text(o, r)
    elif tag == 'spl':
        sp = load_spline(o, r); sp['points'] = spline_points(sp)
        files.append(('splines', f'{base}.spl.json', _js(sp)))
    elif tag == 'sid':
        sd = load_sid(o, r)
        dn = sd['display_name']
        if isinstance(dn, dict):                        # name lives in a txt resource, often in another OVL
            h = lib.find(dn['import'])
            sd['display_name'] = text(h[0], h[1]) if h else dn['import']
        files.append(('data/sid', f'{base}.json', _js(sd)))
        info.update({k: sd[k] for k in ('display_name', 'type', 'cost', 'visuals', 'icon')})
    elif tag == 'ban':
        a = load_ban(o, r)
        files.append(('data/ban', f'{base}.json', _js({'name': a.name, 'duration': a.duration,
            'bones': [{'name': b.name, 'translations': b.translations, 'rotations_axis_angle': b.rotations} for b in a.bones]})))
    elif tag == 'svd':
        sv = load_svd(o, r)
        files.append(('data/svd', f'{base}.json', _js(sv.__dict__ | {'lods': [l.__dict__ for l in sv.lods]})))
    elif tag == 'ppg':
        files.append(('data/ppg', f'{base}.json', _js({'name': r.name, 'levels_of_detail': load_ppg(o, r)})))
    elif tag == 'prt':
        files.append(('data/prt', f'{base}.json', _js({'name': r.name, 'levels_of_detail': [e.__dict__ for e in load_prt(o, r)]})))
    elif tag == 'san':
        files.append(('data/san', f'{base}.json', _js([{'name': c.name, 'times': c.times, 'positions': c.positions,
                                                        'rotations': c.rotations} for c in load_san(o, r)])))
    elif tag == 'sal':
        files.append(('data/sal', f'{base}.json', _js(load_sal(o, r))))
    elif tag == 'phd':
        files.append(('data/phd', f'{base}.json', _js(load_phd(o, r))))
    if tag not in ('tex', 'ftx', 'txt', 'flic', 'btbl'):
        try:
            files.append((f'data/{tag}', f'{base}.fields.json', _js(describe(o, r))))
        except Exception:
            pass
    return files, info
