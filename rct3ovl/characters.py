"""Assemble a whole person (guest, staff, VIP) from its part groups.

A character variant such as AF01 (adult female 01) has part groups AF01_Body, AF01_Legs and AF01_Head (ppg, in
*_Stub OVLs). Each group lists person parts per level of detail; a part pairs a texture with a morph mesh.
The detailed heads (L1, L2) are simple skins whose bone animations are named head_<variant>_l<n>_<animation>
and live in the character's Shared folder; the lowest level uses a morph-mesh head like the body.
"""
from __future__ import annotations

import re

from .library import Library
from .morph import load_morph
from .people import load_ppg, load_prt, load_san, load_ssk


def find_groups(lib: Library, variant: str) -> list[str]:
    v = variant.lower() + '_'
    return sorted(n for n in lib.index['names'] if n.endswith(':ppg') and n.startswith(v))


def assemble(lib: Library, groups: list[str], lod: int = 0, anim_names: list[str] | None = None,
             expression: str = '', detailed_head: bool = True):
    """Returns (morph parts, skins, info). groups: ppg names like 'af01_body:ppg'."""
    morphs, skins, info = [], [], {'parts': [], 'head': None}
    head_tex = None
    head_morphs = []                                    # the group's own head, kept in case the skinned one doesn't fit
    head_group = next((g for g in groups if g.split(':')[0].endswith('_head')), None)
    sh = None
    if detailed_head and lod < 2 and head_group:
        # the skinned head is named after the part variant, which can differ from the group's
        # (popstar01_head lists Head_PF01_L3, and the detailed head is head_pf01_l1)
        cands = [head_group.split('_')[0]]
        hg = lib.find(head_group)
        if hg:
            for level in load_ppg(hg[0], hg[1]):
                for pn in level:
                    bits = pn.lower().split('_')
                    if bits[0] == 'head' and len(bits) >= 3 and bits[1] not in cands:
                        cands.append(bits[1])
        for variant in cands:
            for pre in ('head_', 'ss_head_'):
                sh = (lib.find(f'{pre}{variant}_l{lod + 1}' + (f'_{expression}' if expression else '') + ':ssk')
                      or lib.find(f'{pre}{variant}_l{lod + 1}:ssk'))
                if sh:
                    break
            if sh:
                break
    for gname in groups:
        hit = lib.find(gname)
        if not hit:
            continue
        lods = load_ppg(hit[0], hit[1])
        if not lods:
            continue
        parts = lods[min(lod, len(lods) - 1)]
        for pn in parts:
            if pn.lower().startswith('ss_'):
                continue                                # simple-skin variant used by seated/ride animations
            ph = lib.find(pn)
            if not ph:
                continue
            for e in load_prt(ph[0], ph[1]):
                if not e.mesh.endswith(':mms'):
                    continue
                is_head = pn.lower().startswith('head_')
                if is_head:
                    head_tex = e.texture
                mh = lib.find(e.mesh)
                if mh:
                    part = (load_morph(mh[0], mh[1]), lib.texture_image(e.texture))
                    if is_head and sh:
                        head_morphs.append((part, e.mesh))     # replaced by the skinned head if that fits
                    else:
                        morphs.append(part); info['parts'].append(e.mesh)
                break
    if sh:
        if True:
            skin = load_ssk(sh[0], sh[1])
            clips = {}
            # head animations: head_<variant>_l<n>_<anim>, else shared by the family (AF03 uses AF01's),
            # else in the head's own OVL (staff: SS_Head_LG01_L1_<anim>)
            family = ''.join(c for c in variant if c.isalpha())
            cands = [variant] + sorted({n.split('_')[1] for n in lib.index['names']
                                        if n.startswith('head_' + family) and n.endswith(':san')} - {variant})
            for vv in cands:
                prefix = f'head_{vv}_l{lod + 1}_'
                for n in lib.index['names']:
                    if n.startswith(prefix) and n.endswith(':san'):
                        anim = n[len(prefix):-4]
                        if anim_names is not None and anim.lower() not in [a.lower() for a in anim_names]:
                            continue
                        h = lib.find(n)
                        cl = load_san(h[0], h[1]) if h else []
                        if cl:
                            real = next((a for a in (anim_names or []) if a.lower() == anim), None)
                            clips[real or _pretty_anim(morphs, anim)] = cl[0]
                if clips:
                    break
            if not clips:
                from .export import head_clips
                own = head_clips(lib, sh[0], skin.name) or head_clips(lib, sh[0], 'SS_' + skin.name)
                want = [a.lower() for a in (anim_names or [])]
                clips = {k: v for k, v in own.items() if not want or k.lower() in want} or dict(list(own.items())[:1])
            # only use the skinned head if its animations belong to this body (guests: walk <-> walk, lifeguard:
            # LifeGuardIdle01 on both). VF01 the vendor matches an unrelated SS_Head_VF01 with walk/swim clips, which
            # would float off a serving body: keep the group's own head instead.
            body = {a.lower() for a in animation_names(morphs)}
            norm = lambda k: re.sub(r'^l\d_', '', k.lower())
            if not head_morphs or any(norm(k) in body for k in clips):
                skins.append((skin, clips, lib.texture_image(head_tex) if head_tex else None))
                info['head'] = skin.name
                head_morphs = []
    for part, mesh in head_morphs:
        morphs.append(part); info['parts'].append(mesh)
    return morphs, skins, info


def resolve_anims(morphs, wanted: list[str] | None) -> list[str] | None:
    """Map wanted names onto what the parts really have: exact, then prefix (Idle -> Idle1), case-insensitive;
    if none match, the first animation every part shares."""
    have = animation_names(morphs)
    if wanted is None or not have:
        return wanted
    out = []
    for w in wanted:
        hit = next((h for h in have if h.lower() == w.lower()), None) or \
            next((h for h in have if h.lower().startswith(w.lower())), None)
        if hit and hit not in out:
            out.append(hit)
    if not out:
        common = [h for h in have if all(any(a.name == h for a in mm.anims) for mm, _ in morphs)]
        out = (common or have)[:1]
    return out


def _pretty_anim(morphs, low: str) -> str:
    for mm, _ in morphs:
        for a in mm.anims:
            if a.name.lower() == low:
                return a.name
    return low


def animation_names(morphs) -> list[str]:
    seen = []
    for mm, _ in morphs:
        for a in mm.anims:
            if a.name not in seen:
                seen.append(a.name)
    return seen


def variants(lib: Library, scope: str | None = None) -> dict[str, list[str]]:
    """variant (af01, panda, ...) -> its part-group names."""
    import os
    out = {}
    for n, rel in lib.index['names'].items():
        if n.endswith(':ppg') and (scope is None or os.path.join(lib.root, rel).startswith(scope)):
            out.setdefault(n.split('_')[0], []).append(n)
    return out


# People list categories, from the game's own Characters\<folder> names
_FOLDERS = {
    'AF': ('Guests', 'Adult female'), 'AM': ('Guests', 'Adult male'), 'TF': ('Guests', 'Teen female'),
    'TM': ('Guests', 'Teen male'), 'CF': ('Guests', 'Child female'), 'CM': ('Guests', 'Child male'),
    'HM': ('Staff', 'Handyman'), 'Maintenance': ('Staff', 'Mechanic'), 'SecurityGuard': ('Staff', 'Security guard'),
    'Lifeguard': ('Staff', 'Lifeguard'), 'AnimalKeeper': ('Staff', 'Animal keeper'), 'VM': ('Staff', 'Vendor'),
    'MovieStar': ('VIPs & celebrities', 'Movie star'), 'PopStar': ('VIPs & celebrities', 'Pop star'),
    'Politician': ('VIPs & celebrities', 'Politician'), 'PI': ('VIPs & celebrities', 'Park inspector'),
    'JoeSlugger': ('VIPs & celebrities', 'Joe Slugger'), 'BobWaterman': ('VIPs & celebrities', 'Bob Waterman'),
    'Smythe': ('VIPs & celebrities', 'Smythe'),
}
_GROUP_ORDER = ['Guests', 'Staff', 'Entertainers', 'VIPs & celebrities', 'Other']


def describe_variant(lib: Library, variant: str, groups: list[str]) -> dict:
    """{'variant', 'group', 'label'} from the folder the character's part groups live in, e.g. VF01 is in
    Characters\\VM -> Staff / Vendor (female)."""
    rel = next((lib.index['names'].get(g) for g in groups if lib.index['names'].get(g)), '') or ''
    parts = rel.replace('/', '\\').split('\\')
    folder = parts[1] if len(parts) > 2 and parts[0].lower() == 'characters' else ''
    if folder.lower() == 'entertainers' and len(parts) > 3:
        group, label = 'Entertainers', {'PumpkinHead': 'Pumpkin head'}.get(parts[2], parts[2])
    else:
        group, label = _FOLDERS.get(folder, ('Other', folder or variant.upper()))
    if folder == 'VM':
        label += ' (female)' if variant.lower().startswith('vf') else ' (male)'
    return {'variant': variant, 'group': group, 'label': label}


def build_person(lib: Library, variant: str, anim_names: list[str] | None, all_variants=None, lod: int = 0,
                 expression: str = '', outfit: int | None = 0):
    """-> (glb bytes, info) for a whole person, or None. Head-only variants (AF03) wear their family's base
    outfit (AF01 body + legs); animation names are matched loosely (Idle -> Idle1)."""
    from .gltf_people import people_to_glb
    vs = all_variants or variants(lib)
    groups = vs.get(variant.lower(), [])
    has = lambda gs, part: any(g.endswith(f'_{part}:ppg') for g in gs)
    main = [g for g in groups if any(g.endswith(f'_{p}:ppg') for p in ('body', 'legs', 'head'))] or list(groups)
    family = ''.join(c for c in variant.lower() if c.isalpha())
    for part in ('body', 'legs'):
        if has(main, 'head') and not has(main, part):
            donor = next((v for v in sorted(vs) if ''.join(c for c in v if c.isalpha()) == family and has(vs[v], part)), None)
            if donor:
                main.append(f'{donor}_{part}:ppg')
    m, s, info = assemble(lib, main, lod, anim_names, expression)
    if not m and not s:
        return None
    use = resolve_anims(m, anim_names)
    if use != anim_names:
        m, s, info = assemble(lib, main, lod, use, expression)
    # outfit: colour-variant tile of each part's texture (0 = top-left); parts with fewer tiles wrap around
    info.update({'groups': main, 'animations': animation_names(m), 'exported_animations': use,
                 'outfits': max((mm.variant_count(img) for mm, img in m), default=1)})
    m = [(mm.with_variant(outfit, img), img) for mm, img in m]
    return people_to_glb(m, s, use, variant.upper()), info
