"""One real example of each resource type: where it lives and which strings / imports / numbers it holds.
Used to write the README's file-type guide from actual data.
usage: python tests/type_samples.py "<game folder>" [tag ...]
"""
import collections
import sys

sys.path.insert(0, __file__.rsplit('tests', 1)[0])
from rct3ovl.library import Library  # noqa: E402
from rct3ovl.structs import describe  # noqa: E402


def flat(fields, depth=0, out=None):
    out = out if out is not None else collections.OrderedDict(strings=[], imports=[], resources=[], numbers=[])
    for f in fields:
        (k, v), = f.items()
        if isinstance(v, dict):
            if 'import' in v:
                out['imports'].append(v['import'])
            if 'string' in v:
                out['strings'].append(v['string'])
            if 'resource' in v:
                out['resources'].append(v['resource'])
            if 'data' in v and depth < 2:
                flat(v['data'], depth + 1, out)
        elif depth == 0 and v != 0 and len(out['numbers']) < 14:
            out['numbers'].append(f'{k}={v}')
    return out


lib = Library(sys.argv[1])
want = set(sys.argv[2:])
seen = collections.Counter(); where = collections.defaultdict(set); example = {}
for ov in lib.index['ovls']:
    for tag in ov.get('counts', {}):
        top = ov['path'].split('\\')[0].split('/')[0]
        where[tag].add(top)
        if (not want or tag in want) and tag not in example:
            example[tag] = ov['path']
for tag, path in sorted(example.items()):
    o, _ = lib.open(path)
    r = next(x for x in o.resources if x.loader.tag == tag)
    try:
        d = describe(o, r); fl = flat(d['fields'])
    except Exception as e:  # noqa: BLE001
        print(f'== {tag}: {e!r}'); continue
    print(f'== {tag} ({r.loader.name})  e.g. {r.name or "(unnamed)"} in {path}  [{len(d["fields"])} fields, '
          f'extra data {d["extra_data_bytes"]}]  folders: {", ".join(sorted(where[tag]))[:120]}')
    for k, v in fl.items():
        if v:
            print(f'   {k}: {v[:14]}')
