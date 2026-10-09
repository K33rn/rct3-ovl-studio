"""Parks: the campaign scenarios (Campaigns\\Base\\*.dat, Base\\Soaked, Base\\Wild) and the sandbox (Campaigns\\Sandbox).

A park is a whole saved game in the same self-describing format as ride designs and fireworks (trk.py): ~150 types,
thousands of objects. What the viewer uses:
- RCT3Terrain.EngineTerrain (blob): u8 cols, u8 rows, f32 x0, z0 (world corner, metres), f32 tile size x, z (4 m),
  then 24 bytes per tile, row by row: f32 heights of its corners (x0z0, x1z0, x0z1, x1z1; neighbours share them),
  u8 ground texture (terrain_NN), u8 cliff style, u8, u8 diagonal (which way the tile is split in two triangles),
  u8 ownership bits (2 owned, 1/4 construction rights, 32 park entrance, 64 for sale), 3 more bytes.
- WaterManager.WaterManager (blob): u8 cols, u8 rows, u32 bodies, each: f32 surface height, u32 n, n x (u8 col,
  u8 row, u8 triangle 0/1, u8 corner mask).
- Placed things (scenery, track pieces, flat rides, stalls, path pieces) each have a SceneryItemDataField: POSX/POSZ
  (column/row), HEIGHT (metres, same space as the terrain), DIRECTION (0-3), CORNER (quarter tile), and point at a
  SIDDatabaseEntry {SYMBOLNAME, OVERLAYFILENAME} - the sid the game builds it from. Tile (c, r) is centred on
  (x0 + 4c + 2, z0 + 4r + 2).
- Ground paths are PathTile / PathGround {ColIndex, RowIndex, Surface -> PathTypeDatabaseEntry.SystemName}; raised
  paths (PathFlying) are path pieces with a SceneryItem; queues are PathQueue.
- People (Guest, staff) and ducks have a WorldMatrix (4x4 floats).
- Objectives: Objective {Difficulty 0-2 (Apprentice, Entrepreneur, Tycoon), Prize} and one object per condition
  (ParkGuestsCondition, ParkValueCondition, CoasterCondition {Flags: stat | 16 maximum | 64 water slides, CmpVal}…),
  each with Difficulty, Value, Consistant (months it must be held). Challenges (Soaked!/Wild!) are conditions with
  IsChallengeCondtion set.
Scenario titles and descriptions come from the game's text: scenarioNN_lookup -> key -> scenario<key>_title/_text.
"""
from __future__ import annotations

import glob
import os
import struct

import numpy as np

from .anims import load_ban, load_svd
from .container import OvlError
from .designs import lay_track, piece_chains, track_glb
from .gltf import shape_to_glb
from .library import Library
from .media import text
from .meshes import load_shape
from .rides import _imports, _short, list_rides, track_sets
from .scenery import list_scenery
from .structs import SID_SIZES, load_sid
from .trk import Trk

GROUPS = [('Campaigns\\Base', 'scenario', 'RollerCoaster Tycoon 3'), ('Campaigns\\Base\\Soaked', 'aop0_scenario', 'Soaked!'),
          ('Campaigns\\Base\\Wild', 'aop1_scenario', 'Wild!'), ('Campaigns\\Sandbox', None, 'Sandbox')]
DIFFICULTY = ['Apprentice', 'Entrepreneur', 'Tycoon']
# CoasterCondition stat ids (the order of the game's CoasterCondition_* texts), with units
COASTER_STATS = [('Excitement', ''), ('Intensity', ''), ('Nausea', ''), ('Length', 'm'), ('-G', 'G'), ('+G', 'G'),
                 ('Lateral G', 'G'), ('Speed', 'm/s'), ('Altitude', 'm'), ('Air time', 's'), ('Inversions', ''),
                 ('Highest drop', 'm')]
PERSON_TYPES = {'Guest': 'Guest', 'Handyman': 'Handyman', 'Mechanic': 'Mechanic', 'Entertainer': 'Entertainer',
                'Security': 'Security guard', 'Vendor': 'Vendor', 'ParkInspector': 'Park inspector',
                'Lifeguard': 'Lifeguard', 'Zookeeper': 'Zookeeper', 'Keeper': 'Zookeeper'}


def _txt(lib: Library, key: str) -> str | None:
    h = lib.find(key + ':txt')
    if not h:
        return None
    try:
        return text(h[0], h[1])
    except OvlError:
        return None


def _name(lib: Library, s) -> str:
    """'#RideNameTumbler#' -> the game's text for RideNameTumbler; other names as they are."""
    if isinstance(s, str) and len(s) > 2 and s.startswith('#') and s.endswith('#'):
        return _txt(lib, s.strip('#')) or s.strip('#')
    return s or ''


def _park_name(lib: Library, s) -> str:
    """'#ME#' / '%ME%' stand for the scenario's own name (filled in by the game): '' then, and the title is shown."""
    s = _name(lib, s)
    return '' if s in ('ME', '%ME%', '#ME#') else s


def _scenario_keys(lib: Library) -> dict:
    """file name (lower) -> (group index, number, key) from the career map's lookup texts."""
    cache = getattr(lib, '_scenario_keys', None)
    if cache is None:
        cache = {}
        for gi, (_, prefix, _) in enumerate(GROUPS):
            if not prefix:
                continue
            for i in range(1, 40):
                key = _txt(lib, f'{prefix}{i:02d}_lookup')
                if not key:
                    continue
                fname = _txt(lib, key + '_filename') or key
                cache[fname.lower()] = (gi, i, key)
        lib._scenario_keys = cache
    return cache


def list_parks(lib: Library) -> list[dict]:
    keys = _scenario_keys(lib)
    out = []
    for gi, (folder, _, group) in enumerate(GROUPS):
        for f in sorted(glob.glob(os.path.join(lib.root, folder, '*.dat'))):
            base = os.path.basename(f)[:-4]
            k = keys.get(base.lower())
            key = k[2] if k and k[0] == gi else None
            title = (_txt(lib, f'scenario{key}_title') if key else None) or \
                (_txt(lib, 'sandboxscenario_title') if group == 'Sandbox' else None) or _spaced(base)
            out.append({'file': os.path.relpath(f, lib.root), 'group': group, 'number': k[1] if key else None,
                        'title': title, 'size': os.path.getsize(f)})
    order = {g[2]: i for i, g in enumerate(GROUPS)}
    out.sort(key=lambda p: (order[p['group']], p['number'] is None, p['number'] or 0, p['title'].lower()))
    return out


def _spaced(s: str) -> str:
    out = ''
    for i, c in enumerate(s):
        if i and c.isupper() and (s[i - 1].islower() or (i + 1 < len(s) and s[i + 1].islower() and s[i - 1] != ' ')):
            out += ' '
        out += c
    return out


def park_path(lib: Library, rel: str) -> str | None:
    rel = rel.replace('/', '\\')
    for p in list_parks(lib):
        if p['file'].lower() == rel.lower():
            return os.path.join(lib.root, p['file'])
    return None


def _load(lib: Library, rel: str) -> Trk:
    p = park_path(lib, rel)
    if not p:
        raise OvlError('no such park')
    cache = lib.__dict__.setdefault('_parks', {})
    key = (p, os.path.getmtime(p))
    if key not in cache:
        if len(cache) > 3:
            cache.pop(next(iter(cache)))
        cache[key] = Trk(open(p, 'rb').read())
    return cache[key]


def finite(v):
    """NaN / infinity (some saves hold them, e.g. an unused research timer) -> None, so the result is valid JSON."""
    if isinstance(v, float):
        return v if v == v and v not in (float('inf'), float('-inf')) else None
    if isinstance(v, dict):
        return {k: finite(x) for k, x in v.items()}
    if isinstance(v, list):
        return [finite(x) for x in v]
    return v


def _graph(b) -> list[float] | None:
    """graphedValue: i32 -1, i32 64, i32 64, 64 floats: the last 64 samples, newest first (the first is the current
    value: GuestsInPark[0] is the park's guest count). Returned oldest first."""
    if not isinstance(b, (bytes, bytearray)) or len(b) != 268:
        return None
    return [round(x, 3) for x in struct.unpack_from('<64f', b, 12)][::-1]


def _matrix(b):
    if not isinstance(b, (bytes, bytearray)) or len(b) < 64:
        return None
    m = struct.unpack_from('<16f', b, 0)
    return m


# ---- what the park is: header, goals, rides, shops, people, money, research --------------------------------------
def park_info(lib: Library, rel: str) -> dict:
    t = _load(lib, rel)
    O = t.objects
    one = lambda n: next((v for _, (nn, v) in O.items() if nn == n), {})
    every = lambda n: [(oid, v) for oid, (nn, v) in O.items() if nn == n]
    sym = lambda ref: O.get(ref, ('', {}))[1].get('SYMBOLNAME', '') if isinstance(ref, int) else ''
    park, money, dat, gt = one('Park'), one('Money'), one('GUI2_DatDesc'), one('GameTime')
    base = os.path.basename(rel)[:-4]
    k = _scenario_keys(lib).get(base.lower())
    key = k[2] if k else None
    group = next((p['group'] for p in list_parks(lib) if p['file'].lower() == rel.replace('/', '\\').lower()), '')
    info = {
        'file': rel, 'group': group, 'number': k[1] if k else None,
        'title': (_txt(lib, f'scenario{key}_title') if key else None) or park.get('ScenarioName') or _spaced(base),
        'description': (_txt(lib, f'scenario{key}_text') if key else None) or
                       (_txt(lib, 'sandboxscenario_description') if group == 'Sandbox' else None) or '',
        'scenario_name': park.get('ScenarioName', ''), 'park_name': _park_name(lib, dat.get('DatParkName') or park.get('Name')),
        'date': {'year': dat.get('DatYear'), 'month': dat.get('DatMonth'), 'minutes': dat.get('DatMinutesSinceMidnight')},
        'guests': dat.get('DatGuestCountInt'),
        'opening': park.get('OpeningTimeMinutes'), 'closing': park.get('ClosingTimeMinutes'),
        'park': {k2: v for k2, v in park.items() if isinstance(v, (int, float, str)) and k2 not in ('Name',)},
        'park_graphs': {k2: _graph(v) for k2, v in park.items() if _graph(v)},
        'money': {k2: v for k2, v in money.items() if isinstance(v, (int, float))},
        'money_graphs': {k2: _graph(v) for k2, v in money.items() if _graph(v)},
        'monthly': money.get('MonthlyExpendature', []),
        'weather': {k2: v for k2, v in one('Weather').items() if isinstance(v, (int, float))},
        'time': gt,
        'staff_settings': {k2: v for k2, v in one('StaffSettings').items() if isinstance(v, (int, float))},
    }
    # goals per difficulty, and challenges
    objectives = {v['Difficulty']: v for _, v in every('Objective') if v.get('ObjectiveId') == 0}
    goals = [{'level': DIFFICULTY[d], 'prize': objectives.get(d, {}).get('Prize'), 'conditions': []} for d in range(3)]
    challenges = {}
    for oid, (n, v) in O.items():
        if not n.endswith('Condition'):
            continue
        c = _condition(lib, O, n, v)
        if v.get('IsChallengeCondtion'):
            challenges.setdefault(v.get('ChallengeId', 0), []).append(c)
        elif 0 <= v.get('Difficulty', -1) < 3:
            goals[v['Difficulty']]['conditions'].append(c)
    for g in goals:
        g['conditions'].sort(key=lambda c: c['id'])
    info['goals'] = goals
    info['challenges'] = []
    ck = _challenge_key(lib, key, base) if challenges else None
    for cid, conds in sorted(challenges.items()):
        ct = (lambda s: _txt(lib, f'challenge_{ck}{cid + 1}{s}') if ck else None)
        info['challenges'].append({'title': ct('title') or f'Challenge {cid + 1}', 'text': ct('') or '',
                                   'completed': ct('comp') or '', 'conditions': conds})
    # rides
    trr_titles = {s['ride']: s['title'] for s in track_sets(lib)}
    anr_titles = {r['name'].lower(): r['title'] for r in list_rides(lib)}
    rides = []
    for oid, v in every('TrackedRideInstance'):
        s = sym(v.get('AIDDatabaseEntry'))
        tr = v.get('TestResults') or {}
        rides.append({'id': oid, 'kind': 'tracked', 'name': _name(lib, v.get('Name')), 'type': s,
                      'type_title': trr_titles.get((s if ':' in s else s + ':trr').lower(), _spaced(s)),
                      **_ride_common(v), 'trains': v.get('NTrains'), 'cars_per_train': v.get('NCarsPerTrain'),
                      'platform': f"{v.get('PlatformStyle', '')} {v.get('PlatformType', '')}".strip(),
                      'stats': {k2: v2 for k2, v2 in tr.items() if isinstance(v2, (int, float))} if isinstance(tr, dict) else {}})
    for oid, v in every('AnimatedRideInstance'):
        s = v.get('AnimatedRideSymbolName', '')
        rides.append({'id': oid, 'kind': 'flat', 'name': _name(lib, v.get('Name')), 'type': s,
                      'type_title': anr_titles.get(s.lower(), _spaced(s.split(':')[0])), **_ride_common(v),
                      'music': v.get('RideMusicSelection', '')})
    for oid, v in every('SpecialAttractionInstance'):
        s = v.get('SpecialAttractionSymbolName', '')
        rides.append({'id': oid, 'kind': 'special', 'name': _name(lib, v.get('Name')), 'type': s,
                      'type_title': _spaced(s.split(':')[0]), **_ride_common(v)})
    info['rides'] = rides
    titles = {s['name'].lower(): s['title'] for s in list_scenery(lib)}
    shops = []
    for oid, v in every('StallInstance'):
        s = v.get('StallSymbolName', '')
        items = []
        for it in v.get('ShopItems') or []:
            iv = O.get(it, ('', {}))[1] if isinstance(it, int) else it
            if isinstance(iv, dict):
                nm = iv.get('Name') or ''
                if not nm or '%ME%' in nm:
                    cid = O.get(iv.get('CIDEntry'), ('', {}))[1].get('SymbolName', '')
                    nm = _item_title(lib, cid.split(':')[0])
                items.append({'name': _name(lib, nm), 'price': iv.get('Price'), 'sold': iv.get('TotalSold')})
        shops.append({'id': oid, 'name': _name(lib, v.get('Name')), 'type': s,
                      'type_title': titles.get((s.split(':')[0] + ':sid').lower(), _spaced(s.split(':')[0])),
                      **_ride_common(v), 'items': items})
    info['shops'] = shops
    for r in rides + shops:                    # unnamed attractions: '%ME% 1' is shown as '<ride type> 1'
        if '%ME%' in r['name']:
            r['name'] = r['name'].replace('%ME%', r['type_title']).strip()
    # people
    people = {}
    for oid, (n, v) in O.items():
        if 'WorldMatrix' in v and n in PERSON_TYPES:
            people.setdefault(n, []).append(v)
    guests = people.get('Guest', [])
    hap = [g.get('CurrentHealth', {}).get('HappinessF') for g in guests if isinstance(g.get('CurrentHealth'), dict)]
    cash = [g.get('CashInfo', {}).get('CurrentCash') for g in guests if isinstance(g.get('CashInfo'), dict)]
    info['people'] = {
        'guests': len(guests), 'in_park': sum(1 for g in guests if g.get('IsInPark')),
        'avg_happiness': round(float(np.mean([h for h in hap if h is not None])), 3) if hap else None,
        'avg_cash': round(float(np.mean([c for c in cash if c is not None]))) if cash else None,
        'staff': [{'type': PERSON_TYPES[n], 'name': _staff_name(lib, v.get('NameS'), PERSON_TYPES[n]),
                   'happiness': v.get('Happiness'), 'state': v.get('State')}
                  for n, vs in people.items() if n != 'Guest' for v in vs],
        'guest_list': [{'name': g.get('NameS', ''), 'happiness': (g.get('CurrentHealth') or {}).get('HappinessF'),
                        'energy': (g.get('CurrentHealth') or {}).get('EnergyF'), 'nausea': (g.get('CurrentHealth') or {}).get('NauseaF'),
                        'cash': (g.get('CashInfo') or {}).get('CurrentCash'), 'spent': (g.get('CashInfo') or {}).get('TotalSpent'),
                        'rides': g.get('NumRidesDone'), 'in_park': bool(g.get('IsInPark'))} for g in guests],
    }
    info['research'] = [{'name': _txt(lib, 'ResearchCategory_' + v.get('CategoryName', '')) or _spaced(v.get('CategoryName', '')),
                         'budget': v.get('Budget'), 'level': v.get('CurrentLevel'), 'invented': bool(v.get('IsInvented')),
                         'available': bool(v.get('IsAvailable'))} for _, v in every('ResearchCategoryInstance')]
    sr = one('SimpleResearch')
    info['research_settings'] = {k2: v for k2, v in sr.items() if isinstance(v, (int, float)) and not k2.endswith('Item')}
    info['awards'] = {k2: v for k2, v in one('Awards').items() if isinstance(v, (int, float))}
    counts = {}
    for n, v in O.values():
        counts[n] = counts.get(n, 0) + 1
    info['object_counts'] = dict(sorted(counts.items(), key=lambda kv: -kv[1]))
    sc = {}
    for _, v in every('SceneryItem'):
        own = O.get(v.get('Owner'), ('',))[0]
        if own == 'SceneryItem':
            s = sym(v.get('DATABASEENTRY'))
            sc[s] = sc.get(s, 0) + 1
    info['scenery_counts'] = [{'name': s, 'title': titles.get(s.lower() + ':sid', _spaced(s)), 'count': c}
                              for s, c in sorted(sc.items(), key=lambda kv: -kv[1])]
    info['available'] = {
        'rides': sorted({sym(oid2) for oid2, v in every('AIDDatabaseEntry') if v.get('IsAvailable') and not v.get('IsHidden')}),
        'items': len([1 for _, v in every('SIDDatabaseEntry') if v.get('IsAvailable')])}
    return info


def _ride_common(v: dict) -> dict:
    ra = v.get('RideAssessmentResults') or {}
    rt = ra.get('AssessmentRatings') if isinstance(ra, dict) else None
    return {'price': v.get('TicketPrice'), 'popularity': v.get('Popularity'), 'satisfaction': v.get('Satisfaction'),
            'total_guests': v.get('TotalGuests'), 'total_profit': v.get('TotalProfit'),
            'running_cost': v.get('AssessedRunningCost'), 'state': v.get('State'),
            'ratings': [round(x, 2) for x in rt] if isinstance(rt, list) and len(rt) == 3 else None,
            'reliability': ra.get('AssessmentReliability') if isinstance(ra, dict) else None}


def _item_title(lib: Library, sym: str) -> str:
    """A carried item's (cid) name from its own text."""
    if not sym:
        return ''
    h = lib.find(sym + ':cid')
    if h:
        txt = next((i for i in _imports(h[0], h[1]) if i.lower().endswith(':txt')), None)
        t = _txt(lib, txt[:-4]) if txt else None
        if t:
            return t
    return _spaced(sym)


def _challenge_key(lib: Library, key: str | None, base: str) -> str | None:
    """The prefix of a park's challenge texts (challenge_<prefix>1title): spelled freely in the game
    (captbc, world_of_the_sea, foutainofyouth)."""
    import difflib
    import re
    cands = getattr(lib, '_challenge_keys', None)
    if cands is None:
        cands = sorted({m.group(1) for k in lib.index['names'] for m in [re.match(r'challenge_(.+?)\d+title:txt$', k)] if m})
        lib._challenge_keys = cands
    norm = lambda s: re.sub(r'[^a-z]', '', s.lower())
    alias = {'captbc': 'captainblackheartscove'}
    table = {norm(alias.get(c, c)): c for c in cands}
    for want in (key or '', base):
        if norm(want) in table:
            return table[norm(want)]
    m = difflib.get_close_matches(norm(key or base), list(table), n=1, cutoff=0.8)
    return table[m[0]] if m else None


def _staff_name(lib, s, typ):
    if isinstance(s, str) and s.startswith('%ME%'):
        return typ + s[4:]
    return s or typ


def _condition(lib: Library, O: dict, n: str, v: dict) -> dict:
    """One goal as text: {id, type, label, target, held}."""
    label, target = n.replace('Condition', ''), v.get('Value')
    money = lambda c: f'${c / 100:,.0f}' if isinstance(c, (int, float)) else str(c)
    sym = lambda ref: O.get(ref, ('', {}))[1].get('SYMBOLNAME', '') if isinstance(ref, int) else ''
    simple = {'ParkGuestsCondition': ('objectivecondition_parkguests', str), 'ParkValueCondition': ('objectivecondition_parkvalue', money),
              'ParkRatingCondition': ('objectivecondition_parkrating', str), 'RideIncomeCondition': ('objectivecondition_rideincome', money),
              'ShopProfitCondition': ('objectivecondition_shopprofit', money), 'PoolGuestsCondition': ('objectivecondition_poolguests', str),
              'PoolIncomeCondition': ('objectivecondition_poolincome', money),
              'EnclosureIncomeCondition': ('objectivecondition_enclosureincome', money),
              'EnclosureVisitorsCondition': ('objectivecondition_enclosurevisitors', str),
              'MinAnimalHealthCondition': ('objectivecondition_minanimalhealth', lambda x: f'{x}%'),
              'MaxAnimalHealthCondition': ('objectivecondition_maxanimalhealth', str),
              'AnimalSalesProfitCondition': ('objectivecondition_animalsalesprofit', money),
              'DungTargetCondition': ('objectivecondition_dungtarget', str),
              'EscapedAnimalsCondition': ('objectivecondition_escapedanimals', str),
              'ViewingGalleriesCondition': ('objectivecondition_viewinggalleries', str),
              'NumAnimalsOfSpeciesCondition': ('objectivecondition_numanimalsofspecies', str),
              'ReleaseAnimalsCondition': ('objectivecondition_releaseanimals', str),
              'NumSceneryItemsOfClassificationCondition': ('objectivecondition_numsceneryitemsofclassification', str),
              'ItemsBoughtCondition': ('objectivecondition_itemsbought', str)}
    extra = ''
    if n in simple:
        k, fmt = simple[n]
        label = _txt(lib, k) or label
        target = fmt(target) if target is not None else ''
        if n == 'ItemsBoughtCondition':
            it, st = sym(v.get('Item')) or O.get(v.get('Item'), ('', {}))[1].get('Name', ''), sym(v.get('Stall'))
            extra = ' '.join(x for x in (_spaced(str(it).split(':')[0]) if it else '', f'(from {_spaced(st)})' if st else '') if x)
        if 'Species' in v:
            extra = f'species #{v["Species"]}'
    elif n == 'RepayLoanCondition':
        label, target = _txt(lib, 'objectivecondition_repayloan') or 'Repay loan', ''
    elif n == 'NumWellThemedAttractionsCondition':
        label, target = _txt(lib, 'objectivecondition_numwellthemedattractions') or 'Themed attractions', str(v.get('TargetNum'))
        extra = f'theme #{v.get("Theme")}'
    elif n == 'CoasterCondition':
        f = v.get('Flags', 0)
        stat, unit = COASTER_STATS[f & 15] if (f & 15) < len(COASTER_STATS) else (f'stat {f & 15}', '')
        what = 'water slides' if f & 64 else 'coasters'
        nr = v.get('NumRequired', 1)
        val = v.get('CmpVal', 0)
        val = round(val, 2)
        label = f"{'Maximum' if f & 16 else 'Minimum'} {stat.lower() if stat[0].isalpha() else stat}"
        target = f'{val:g}{(" " + unit) if unit else ""}' + (f' ({val * 3.6:.0f} km/h)' if unit == 'm/s' else '')
        extra = f"{'all ' + what if nr < 0 else f'{nr} {what[:-1] if nr == 1 else what}'}"
    elif n == 'VIPCondition':
        label, target = _txt(lib, 'objectivecondition_vip') or 'VIP', ''
        bits = []
        if v.get('CoastersNeeded'):
            bits.append(f"rides {v['CoastersNeeded']} coaster{'s' if v['CoastersNeeded'] > 1 else ''}"
                        + (f" with excitement {v['MinExcitment']:g}+" if v.get('MinExcitment') else ''))
        if v.get('SceneryNeeded'):
            bits.append(f"sees {v['SceneryNeeded']} scenery items")
        if v.get('MonthsToStayInPark'):
            bits.append(f"stays {v['MonthsToStayInPark']} month{'s' if v['MonthsToStayInPark'] > 1 else ''}")
        if v.get('InsertionInterval'):
            bits.append(f"visits every {v['InsertionInterval']} months")
        extra = ', '.join(bits)
    held = v.get('Consistant') or 0
    when = ''
    if held:
        when = (_txt(lib, f'objectivecondition_for{held}month{"s" if held > 1 else ""}') or f'Sustained for {held} months.') \
            if held <= 3 else f'Sustained for at least {held} months.'
    return {'id': v.get('ConditionId', 0), 'type': n, 'label': label, 'target': target, 'detail': extra, 'held': when,
            'gt': v.get('GT', 1)}


# ---- the world: terrain, water, paths, placed things, people ------------------------------------------------------
def park_world(lib: Library, rel: str) -> dict:
    t = _load(lib, rel)
    O = t.objects
    ter = next(v for n, v in O.values() if n == 'RCT3Terrain')['EngineTerrain']
    W, H = ter[0], ter[1]
    x0, z0, sx, sz = struct.unpack_from('<4f', ter, 2)
    raw = np.frombuffer(ter, np.uint8, W * H * 24, 18).reshape(H * W, 24)
    heights = np.frombuffer(ter, '<f4', W * H * 6, 18).reshape(H * W, 6)[:, :4]
    hgrid = heights.reshape(H, W, 4)
    world = {'cols': W, 'rows': H, 'x0': x0, 'z0': z0, 'tile': sx,
             'heights': np.round(heights.ravel() * 100).astype(int).tolist(),          # cm, 4 corners per tile
             'tex': raw[:, 16].tolist(), 'split': raw[:, 19].tolist(), 'own': raw[:, 20].tolist()}
    # water
    wm = next((v for n, v in O.values() if n == 'WaterManager'), {}).get('WaterManager', b'')
    bodies = []
    if len(wm) >= 6:
        nb = struct.unpack_from('<I', wm, 2)[0]
        p = 6
        for _ in range(nb):
            if p + 8 > len(wm):
                break
            h, n = struct.unpack_from('<fI', wm, p); p += 8
            tiles = list(wm[p:p + 4 * n]); p += 4 * n
            bodies.append({'h': round(h, 3), 'tiles': tiles})
    world['water'] = bodies
    # ground paths and queues
    paths = []
    styles = []
    for oid, (n, v) in O.items():
        if n in ('PathTile', 'PathGround', 'PathQueue') and 'ColIndex' in v:
            surf = O.get(v.get('Surface'), ('', {}))
            if surf[0] == 'PathTypeDatabaseEntry':
                style = surf[1].get('SystemName', '')
            elif surf[0] == 'QueueTypeGroundSurface':
                style = 'queue:' + O.get(surf[1].get('QueueType'), ('', {}))[1].get('SystemName', '')
            else:
                style = ''
            if style not in styles:
                styles.append(style)
            raised = n == 'PathQueue' and v.get('BaseHeight', -1) >= 0
            paths.append([v['ColIndex'], v['RowIndex'], styles.index(style), v.get('QuantisedHeight', 0) if raised else -9999,
                          v.get('SlopeType', 0), v.get('Direction', 0)])
    world['paths'] = paths
    world['path_styles'] = styles
    # placed things
    sids, items = [], []
    sid_index = {}

    def sid_of(ref):
        e = O.get(ref, ('', {}))[1]
        key = (e.get('SYMBOLNAME', ''), e.get('OVERLAYFILENAME', ''))
        if key not in sid_index:
            sid_index[key] = len(sids); sids.append({'name': key[0], 'overlay': key[1]})
        return sid_index[key]

    def place(gd, sid, kind, ref=None, absolute=False):
        c, r = gd['POSX'], gd['POSZ']
        y = float(gd['HEIGHT'])
        if not absolute and 0 <= c < W and 0 <= r < H:
            lo, hi = float(hgrid[r, c].min()), float(hgrid[r, c].max())
            if lo - 0.01 <= y <= hi + 0.01:
                y = float(hgrid[r, c].mean())          # on sloping ground: sit on the slope, not its low corner
        items.append([sid, c, r, round(y, 3), gd['DIRECTION'], gd['CORNER'], kind, ref if ref is not None else -1])

    kinds = {'SceneryItem': 0, 'PathFlying': 1, 'TrackPlatformPiece': 2, 'SceneryItemPlacementSingle': 3, 'TrackPiece': 4,
             'TrackExtraPiece': 2}
    for oid, (n, v) in O.items():
        if n == 'SceneryItem':
            own = O.get(v.get('Owner'), ('', {}))
            if own[0] == 'TrackPiece':
                continue                                   # laid by the track builder
            if own[0] == 'SceneryItemPlacementSingle':
                continue                                   # placed below, with the ride or stall it belongs to
            place(v['SceneryItemDataField'], sid_of(v['DATABASEENTRY']), kinds.get(own[0], 0),
                  absolute=bool(v.get('FORCEABSOLUTEHEIGHT')) or own[0] != 'SceneryItem')
        elif n == 'SceneryItemPlacementSingle':
            place(v['SceneryItemDataField'], sid_of(v['SIDDatabaseEntry']), 3, ref=v.get('Owner'))
    world['sids'] = sids
    world['items'] = items
    # tracked rides: one model each (/api/park_track)
    world['tracks'] = [{'id': oid, 'name': _name(lib, v.get('Name'))} for oid, (n, v) in O.items() if n == 'TrackedRideInstance']
    # people and ducks. A person is built from three part groups (body, legs, head: PPGDatabaseEntry.SymbolName,
    # often from different characters, e.g. AM01 body, AM05 legs, AM07 head) -> 'combos', one model each
    people, combos, combo_index = [], [], {}
    ppg = lambda ref: (O.get(ref, ('', {}))[1].get('SymbolName') or '').lower()
    for oid, (n, v) in O.items():
        m = _matrix(v.get('WorldMatrix')) if 'WorldMatrix' in v else None
        if m is None:
            continue
        kind = 'duck' if n == 'Duck' else 'guest' if n == 'Guest' else 'staff' if n in PERSON_TYPES else n.lower()
        if n == 'Guest' and not v.get('IsInPark') and abs(m[12]) < 1e-3 and abs(m[14]) < 1e-3:
            continue
        combo = -1
        groups = tuple(g + ':ppg' for g in (ppg(v.get('BodyPartGroup')), ppg(v.get('LegsPartGroup')), ppg(v.get('HeadPartGroup'))) if g)
        if groups:
            if groups not in combo_index:
                combo_index[groups] = len(combos); combos.append(list(groups))
            combo = combo_index[groups]
        people.append([kind, round(m[12], 2), round(m[13], 2), round(m[14], 2), round(float(np.arctan2(m[8], m[0])), 3),
                       combo, 1 if (v.get('MoveSpeed') or 0) > 0.05 else 0,
                       v.get('UpperClothingPalette') or 0, v.get('LowerClothingPalette') or 0, v.get('SkinPalette') or 0])
    world['people'] = people
    world['person_combos'] = combos
    # ride cars: where each car of each train stood (world position, Euler angles), and which car model it is
    cars, car_models, car_index = [], [], {}
    for oid, (n, v) in O.items():
        if n != 'RideCarInstance' or not isinstance(v.get('Stats'), dict):
            continue
        tr = O.get(v.get('RideTrainInstance'), ('', {}))[1]
        rit = tr.get('RideTrainSymbolName', '')
        st = v['Stats']
        if not rit or not st.get('PosValid', 1):
            continue
        key = (rit, tr.get('RideTrainOverlayName', ''), v.get('WhichRideTrainCar', 2))
        if key not in car_index:
            car_index[key] = len(car_models); car_models.append(list(key))
        orient = st.get('Orient')
        ang = list(struct.unpack('<3f', orient)) if isinstance(orient, (bytes, bytearray)) and len(orient) == 12 else [0, 0, 0]
        p = st.get('Pos') or [0, 0, 0]
        cars.append([car_index[key], round(p[0], 3), round(p[1], 3), round(p[2], 3)] + [round(a, 4) for a in ang])
    world['cars'] = cars
    world['car_models'] = car_models
    # Wild! animals: species (WASDatabaseEntry) and the visual that holds where it stands
    animals = []
    for oid, (n, v) in O.items():
        if n != 'WildAnimal':
            continue
        sp = O.get(v.get('Entry'), ('', {}))[1].get('SYMBOLNAME', '')
        m = _matrix(O.get(v.get('Visual'), ('', {}))[1].get('WorldMatrix'))
        if not sp or m is None:
            continue
        model = animal_mdl(lib, sp, bool(v.get('IsAdult', 1)), bool(v.get('IsMale', 1)))
        if model:
            animals.append([model, round(m[12], 2), round(m[13], 2), round(m[14], 2), round(float(np.arctan2(m[8], m[0])), 3),
                            sp, bool(v.get('IsAdult', 1))])
    world['animals'] = animals
    cam = next((v for n, v in O.values() if n == 'MainCamera'), {})
    world['camera'] = cam.get('Pos')
    return world


# ---- models ----------------------------------------------------------------------------------------------------
def _sid_hit(lib: Library, name: str, overlay: str):
    """The sid, preferring the OVL the park names for it (names repeat across themes)."""
    prefer = None
    if overlay:
        rel = overlay.replace('/', '\\') + '.common.ovl'
        if os.path.exists(os.path.join(lib.root, rel)):
            try:
                prefer = lib.open(rel)[0]
            except Exception:
                prefer = None
    return lib.find(name + ':sid', prefer=prefer)


def sid_model(lib: Library, name: str, overlay: str = '') -> tuple[bytes, dict] | None:
    """A placed item's model: sid -> visual (svd) -> highest-detail shs/bsh, with its bone animations."""
    cache = lib.__dict__.setdefault('_sid_models', {})
    key = (name.lower(), overlay.lower())
    if key in cache:
        return cache[key]
    res = None
    h = _sid_hit(lib, name, overlay)
    if h:
        o, r = h[0], h[1]
        v = struct.unpack('<31I', o.read(r.data, 124))
        squares = [v[4], v[5]] if 0 < v[4] < 64 and 0 < v[5] < 64 else [1, 1]
        size = SID_SIZES[v[2]] if v[2] < len(SID_SIZES) else 'full tile'     # word 2 in both sid layouts
        visuals = [i for i in _imports(o, r) if i.lower().endswith(':svd')]
        if not visuals:
            try:
                visuals = [x for x in load_sid(o, r)['visuals'] if x]
            except Exception:
                visuals = []
        visuals = visuals or [name + ':svd']
        for vis in visuals:
            hv = lib.find_near(vis, o) or lib.find(vis)
            if not hv:
                continue
            try:
                lods = [l for l in load_svd(hv[0], hv[1]).lods if l.model.lower().endswith((':bsh', ':shs'))]
            except Exception:
                continue
            if not lods:
                continue
            hm = lib.find_near(lods[0].model, hv[0]) or lib.find(lods[0].model)
            if not hm:
                continue
            shape = load_shape(hm[0], hm[1])
            anims = []
            for an in lods[0].animations:
                ha = lib.find_near(an, hm[0]) or lib.find(an)
                if ha:
                    try:
                        anims.append(load_ban(ha[0], ha[1]))
                    except OvlError:
                        pass
            for a, short in zip(anims, _short([a.name.split(':')[0] for a in anims])):
                a.name = short[:1].upper() + short[1:]
            glb = shape_to_glb(shape, lambda n: lib.texture_image(n, prefer=hm[0]), anims if shape.bones else None)
            res = (glb, {'name': name, 'squares': squares, 'size': size,
                         'animations': [a.name for a in anims] if shape.bones else []})
            break
    if len(cache) > 600:
        cache.pop(next(iter(cache)))
    cache[key] = res
    return res


def track_model(lib: Library, rel: str, ride_id: int) -> tuple[bytes, dict]:
    """One tracked ride's track, in park coordinates."""
    t = _load(lib, rel)
    O = t.objects
    ride = O[ride_id][1]
    owner = {}
    for oid, (n, v) in O.items():
        if n == 'TrackSegment':
            tr = O.get(v.get('Track'), ('', {}))[1]
            owner[oid] = tr.get('TrackedRideInstance')
    pieces = {oid: v for oid, (n, v) in O.items() if n == 'TrackPiece' and owner.get(v.get('Segment')) == ride_id}
    if not pieces:
        raise OvlError('this ride has no track')
    aid = O.get(ride.get('AIDDatabaseEntry'), ('', {}))[1].get('SYMBOLNAME', '')
    sym = aid if ':' in aid else aid + ':trr'
    chains = [([pieces[o] for o in c], closed) for c, closed in piece_chains(pieces)]
    merged, placed, gaps, missing, ts = lay_track(lib, sym, chains, _name(lib, ride.get('Name')))
    ter = next(v for n, v in O.values() if n == 'RCT3Terrain')['EngineTerrain']
    x0, z0 = struct.unpack_from('<2f', ter, 2)
    shift = np.array([x0 + 2, 0, z0 + 2], np.float32)          # grid tile n (centred on 4n) -> park tile n
    for m in merged.meshes:
        m.positions = m.positions + shift
    return track_glb(lib, merged), {'name': _name(lib, ride.get('Name')), 'type': sym, 'pieces': len(pieces),
                                    'placed': placed, 'missing': sorted(missing),
                                    'closure_gap': round(max(gaps), 3) if gaps else None,
                                    'supports': _supports(merged, ter)}


def _supports(merged, ter: bytes, cell: float = 4.0, clear: float = 1.5) -> list:
    """Support columns for a track: one per 4 m cell the track crosses, from the ground up to the lowest point of the
    track there, where that is more than 1.5 m up (and not under ground: tunnels). [x, z, ground, top] in park space.
    The game builds supports from per-style pieces; these are plain columns in their place."""
    W, H = ter[0], ter[1]
    x0, z0, T, _ = struct.unpack_from('<4f', ter, 2)
    hg = np.frombuffer(ter, '<f4', W * H * 6, 18).reshape(H, W, 6)[:, :, :4]
    P = np.concatenate([m.positions for m in merged.meshes])
    keys = np.floor(P[:, [0, 2]] / cell).astype(np.int64)
    order = np.lexsort((keys[:, 1], keys[:, 0]))
    keys, P = keys[order], P[order]
    split = np.flatnonzero(np.any(np.diff(keys, axis=0), axis=1)) + 1
    out = []
    for grp, k in zip(np.split(P, split), keys[np.r_[0, split]]):
        if len(grp) < 6:
            continue
        low = grp[grp[:, 1] < grp[:, 1].min() + 0.4]            # right under the track's lowest point in the cell
        x, z = float(low[:, 0].mean()), float(low[:, 2].mean())
        c, r = int((x - x0) // T), int((z - z0) // T)
        if not (0 <= c < W and 0 <= r < H):
            continue
        u, v = (x - x0) / T - c, (z - z0) / T - r
        h = hg[r, c]
        ground = (h[0] * (1 - u) + h[1] * u) * (1 - v) + (h[2] * (1 - u) + h[3] * u) * v
        top = float(grp[:, 1].min())
        if top - ground > clear:
            out.append([round(float(x), 2), round(float(z), 2), round(float(ground), 2), round(top - 0.15, 2)])
    return out


def animal_mdl(lib: Library, species: str, adult: bool, male: bool) -> str | None:
    """The Wild! model for an animal of a species: the species' (was) own model, or the adult / male / female / baby
    one of the same name (MaleGorilla, FemaleGorilla, BabyGorilla; CubLion, CalfTGazelle)."""
    cache = lib.__dict__.setdefault('_animal_mdl', {})
    key = (species.lower(), adult, male)
    if key in cache:
        return cache[key]
    h = lib.find(species + ':was')
    own = next((i for i in _imports(h[0], h[1]) if i.lower().endswith(':mdl')), None) if h else None
    all_mdl = [k[:-4] for k in lib.index['names'] if k.endswith(':mdl') and 'transport' not in k]
    names = [k for k in all_mdl if species.lower() in k]          # the species name first (elephant's own was points
    if not names and own:                                        # at the elephant transport ride's model)
        stem = own.split(':')[0].lower()
        for p in ('adult', 'male', 'female', 'baby', 'cub', 'calf'):
            if stem.startswith(p):
                stem = stem[len(p):]
        names = [k for k in all_mdl if stem.replace('adult', '') in k]
    want = (['male', 'adult'] if male else ['female', 'adult']) if adult else ['baby', 'cub', 'calf']
    pick = next((n for w in want for n in names if n.startswith(w) or n.endswith(w)), None)
    if adult and pick is None:
        pick = next((n for n in names if not any(n.startswith(b) or n.endswith(b) for b in ('baby', 'cub', 'calf'))), None)
    pick = pick or (own.split(':')[0] if own else (names[0] if names else None))
    cache[key] = pick
    return pick


def animal_model(lib: Library, name: str) -> tuple[bytes, dict] | None:
    """A Wild! animal model (mdl) with one standing / idle animation."""
    from .mdl import animations_for_mdl, load_mdl
    h = lib.find(name + ':mdl')
    if not h:
        return None
    s = load_mdl(h[0], h[1])
    an = animations_for_mdl(lib, h[1])
    pick = next((a for a in an if any(w in a.name.lower() for w in ('idle', 'stand', 'look'))), an[0] if an else None)
    glb = shape_to_glb(s, lambda n: lib.texture_image(n, prefer=h[0]), [pick] if pick else [])
    return glb, {'name': name, 'animation': pick.name if pick else None}


def person_model(lib: Library, groups: list[str], lod: int = 1) -> tuple[bytes, dict] | None:
    """A guest or staff member from their three part groups (body, legs, head), walking and idle. Each part's
    texture is a grid of colour variants (outfits); the model uses variant 0 and 'variants' gives each material's
    grid [cols, rows, col0, row0] so the viewer can move a guest's UVs to their own clothing colours."""
    from .characters import assemble, resolve_anims
    from .gltf_people import people_to_glb
    cache = lib.__dict__.setdefault('_person_models', {})
    key = tuple(g.lower() for g in groups) + (lod,)
    if key in cache:
        return cache[key]
    res = None
    gs = list(key[:-1])
    m, s, info = assemble(lib, gs, lod, None)
    if m or s:
        use = resolve_anims(m, ['Walk', 'Idle'])
        m, s, info = assemble(lib, gs, lod, use)
        grids = {}
        for mm, img in m:
            try:
                grids[mm.name] = [int(x) for x in mm.variant_grid(img)]
            except Exception:
                pass
        m = [(mm.with_variant(0, img), img) for mm, img in m]
        res = (people_to_glb(m, s, use, gs[0].split('_')[0].upper()), {'groups': gs, 'animations': use or [], 'variants': grids})
    if len(cache) > 400:
        cache.pop(next(iter(cache)))
    cache[key] = res
    return res


def car_model(lib: Library, rit: str, overlay: str, slot: int) -> tuple[bytes, dict] | None:
    """A ride car: the train (rit) lists its cars at +8 + 4 * slot (front, second, middle, second to last, rear,
    link); the car (ric) imports its body's visual (svd) first."""
    cache = lib.__dict__.setdefault('_car_models', {})
    key = (rit.lower(), overlay.lower(), slot)
    if key in cache:
        return cache[key]
    res = None
    prefer = None
    rel = overlay.replace('/', '\\') + '.common.ovl' if overlay else ''
    if rel and os.path.exists(os.path.join(lib.root, rel)):
        try:
            prefer = lib.open(rel)[0]
        except Exception:
            prefer = None
    h = lib.find(rit, prefer=prefer)
    if h:
        o, r = h[0], h[1]
        imp = {s: n for n, s in o.symbol_refs}
        names = [imp.get(r.data + 8 + 4 * k) for k in range(6)]
        ric = (names[slot] if 0 <= slot < 6 else None) or names[2] or names[0]
        hr = lib.find_near(ric, o) if ric else None
        imps = _imports(hr[0], hr[1]) if hr else []
        mdl = next((i for i in imps if i.lower().endswith(':mdl')), None)
        was = next((i for i in imps if i.lower().endswith(':was')), None)
        if not mdl and was:                          # the car is an animal species (Elephant:ric -> Elephant:was)
            hw = lib.find(was)
            ms = [i for i in _imports(hw[0], hw[1]) if i.lower().endswith(':mdl')] if hw else []
            mdl = next((m for m in ms if 'transport' in m.lower()), ms[0] if ms else None)
        if mdl:                                      # an animal as the car (Wild!'s elephant transport)
            res = animal_model(lib, mdl.split(':')[0])
            hr = None
        if hr:
            svd = next((i for i in _imports(hr[0], hr[1]) if i.lower().endswith(':svd')), None)
            hv = (lib.find_near(svd, hr[0]) or lib.find(svd)) if svd else None
            if hv:
                lods = [l for l in load_svd(hv[0], hv[1]).lods if l.model.lower().endswith((':bsh', ':shs'))]
                hm = (lib.find_near(lods[0].model, hv[0]) or lib.find(lods[0].model)) if lods else None
                if hm:
                    shape = load_shape(hm[0], hm[1])
                    res = (shape_to_glb(shape, lambda n: lib.texture_image(n, prefer=hm[0])), {'car': ric, 'model': lods[0].model})
    cache[key] = res
    return res
