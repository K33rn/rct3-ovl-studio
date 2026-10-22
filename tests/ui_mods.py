"""Mod Loader end to end: each download added through the file picker, its install plan shown and installed; the
packages listed; one disabled (its files leave the game) and enabled again, one uninstalled and installed again; the
Ride Designs tab lists the installed designs. Writes into the viewer's game folder and the user folders.
usage: python tests/ui_mods.py <base> <out folder> <download> [<download> ...]"""
import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

base, out, downloads = sys.argv[1], sys.argv[2], sys.argv[3:]
os.makedirs(out, exist_ok=True)
problems = []


def api(path, body=None):
    req = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(), method='GET' if body is None else 'POST')
    return json.load(urllib.request.urlopen(req, timeout=600))


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1600, 'height': 950})
    pg.on('pageerror', lambda e: problems.append(f'pageerror {e}'))
    pg.on('dialog', lambda d: d.accept())
    pg.goto(base + '/')
    pg.evaluate("localStorage.clear(); ['main', 'mods'].forEach(k => localStorage.setItem('rct3ovl.tour.' + k, '1'))")
    pg.reload(); pg.wait_for_function("document.getElementById('rootinfo').textContent.includes('OVL pairs')", timeout=300000)
    pg.click('#b-mods'); pg.wait_for_selector('#md-cats .cat', timeout=60000)
    pg.screenshot(path=f'{out}/0_before.png')
    for k, dl in enumerate(downloads, 1):
        name = os.path.basename(dl)
        pg.set_input_files('#md-file', dl)
        pg.wait_for_selector('#md-modal.open', timeout=600000); pg.wait_for_timeout(300)
        pg.screenshot(path=f'{out}/{k}_plan.png')
        summary = pg.inner_text('#md-plansum')
        before = pg.inner_text('#md-det h2') if pg.query_selector('#md-det h2') else ''
        pg.click('#md-go')
        pg.wait_for_function("!document.querySelector('#md-modal').classList.contains('open')", timeout=600000)
        pg.wait_for_function("t => (document.querySelector('#md-det h2')?.textContent || '') !== t", arg=before, timeout=60000)
        sel = pg.inner_text('#md-det h2') if pg.query_selector('#md-det h2') else ''
        print(f'{name}: {summary} -> selected "{sel}"')
        if not sel:
            problems.append(f'{name}: no package selected after install')
    pg.wait_for_timeout(1000)
    pg.screenshot(path=f'{out}/9_installed.png')
    data = api('/api/mods')
    print('packages:', [(x['name'], x['files'], x['kinds']) for x in data['packages']])
    print('found in the game:', [(x['name'], x['files']) for x in data['found']][:20])
    # disable one with game files and enable it again: its files leave the game folder and come back
    pk = next((x for x in data['packages'] if 'scenery' in x['kinds']), None)
    if pk:
        where = pk['sets'][0]['where']
        pg.click(f'#md-list .pkg[data-id="{pk["id"]}"]'); pg.wait_for_selector('#md-det button[data-act=toggle]')
        pg.click('#md-det button[data-act=toggle]'); pg.wait_for_timeout(2500)
        gone = not os.path.exists(where) or not any(f.endswith('.ovl') for _, _, fs in os.walk(where) for f in fs)
        pg.screenshot(path=f'{out}/10_disabled.png')
        pg.click('#md-det button[data-act=toggle]'); pg.wait_for_timeout(2500)
        back = os.path.isdir(where)
        print(f'disable {pk["name"]}: files gone {gone}, enable: back {back}')
        if not (gone and back):
            problems.append(f'disable / enable {pk["name"]}: gone {gone} back {back}')
    # uninstall the single design and install it again
    one = next((x for x in api('/api/mods')['packages'] if x['kinds'] == {'design': 1} and x['files'] == 1), None)
    if one:
        f = os.path.join(one['sets'][0]['where'], one['sets'][0]['set'])
        pg.click(f'#md-list .pkg[data-id="{one["id"]}"]'); pg.wait_for_selector('#md-det button[data-act=remove]')
        pg.click('#md-det button[data-act=remove]'); pg.wait_for_timeout(2000)
        removed = not os.path.exists(f)
        dl = next(d for d in downloads if os.path.basename(d) == one['source'])
        pg.set_input_files('#md-file', dl); pg.wait_for_selector('#md-modal.open', timeout=60000); pg.click('#md-go')
        pg.wait_for_function("!document.querySelector('#md-modal').classList.contains('open')", timeout=60000); pg.wait_for_timeout(800)
        print(f'uninstall {one["name"]}: removed {removed}, installed again {os.path.exists(f)}')
        if not (removed and os.path.exists(f)):
            problems.append(f'uninstall / install {one["name"]}')
    # the Ride Designs tab lists the installed designs
    pg.click('#md-back'); pg.wait_for_timeout(1500)
    pg.click('#b-designs'); pg.wait_for_selector('#res .res[data-design]', timeout=60000)
    yours = pg.eval_on_selector_all('#res .res[data-design^="yours/"]', 'e => e.map(x => x.textContent)')
    print('Ride Designs, yours:', yours)
    if not yours:
        problems.append('no installed designs on the Ride Designs tab')
    pg.screenshot(path=f'{out}/11_designs.png')
    b.close()
print('problems:', problems or 'none')
