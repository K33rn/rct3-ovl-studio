"""OVL tree: every folder starts closed; ⟳ Refresh finds an OVL in a folder added while the viewer runs and marks it
new; folders you open stay open through a refresh.
usage: python tests/ui_tree_refresh.py http://127.0.0.1:8793 "<game folder the viewer shows>" "<an OVL pair to copy in (.common.ovl)>"
(copies the pair into <game folder>\\ZZ_new_test_folder and removes it again - use a scratch game folder)"""
import os
import shutil
import sys

from playwright.sync_api import sync_playwright

base, root, src = sys.argv[1], sys.argv[2], sys.argv[3]
new_dir = os.path.join(root, 'ZZ_new_test_folder')
problems = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1400, 'height': 900})
    pg.on('pageerror', lambda e: problems.append(f'pageerror {e}'))
    pg.add_init_script("try { localStorage.setItem('rct3ovl.tour.main', '1'); } catch (e) {}")
    pg.goto(base + '/')
    pg.wait_for_selector('#tree details', timeout=120000); pg.wait_for_timeout(1500)
    st = pg.evaluate("() => ({ all: document.querySelectorAll('#tree details').length, open: document.querySelectorAll('#tree details[open]').length })")
    print('at start:', st)
    if st['open']:
        problems.append(f'{st["open"]} folders open at start')
    # open the first folder, then add a folder with an OVL pair and refresh
    pg.click('#tree details > summary')
    first = pg.evaluate("() => document.querySelector('#tree details').dataset.d")
    try:
        os.makedirs(new_dir, exist_ok=True)
        for suf in ('.common.ovl', '.unique.ovl'):
            s = src[:-len('.common.ovl')] + suf
            if os.path.exists(s):
                shutil.copy(s, os.path.join(new_dir, 'Copied' + suf))
        pg.evaluate("() => { document.querySelector('#msg').textContent = ''; }"); pg.click('#treerefresh')
        pg.wait_for_function("() => document.querySelector('#msg').textContent.startsWith('Found')", timeout=60000)
        info = pg.evaluate("""f => ({ msg: document.querySelector('#msg').textContent,
            folder: [...document.querySelectorAll('#tree details')].map(d => d.dataset.d + (d.open ? ' (open)' : '') + (d.querySelector(':scope > summary .b-new') ? ' NEW' : '')),
            firstOpen: [...document.querySelectorAll('#tree details')].find(d => d.dataset.d === f)?.open })""", first)
        print('after refresh:', info)
        if not any(x.startswith('ZZ_new_test_folder/') and x.endswith('NEW') and '(open)' not in x for x in info['folder']):
            problems.append('new folder not listed closed with a "new" mark')
        if not info['firstOpen']:
            problems.append('the folder opened before the refresh closed')
        pg.evaluate("() => { document.querySelector('#msg').textContent = ''; }"); pg.click('#treerefresh')
        pg.wait_for_function("() => document.querySelector('#msg').textContent.includes('No new')", timeout=60000)
    finally:
        shutil.rmtree(new_dir, ignore_errors=True)
    pg.evaluate("() => { document.querySelector('#msg').textContent = ''; }"); pg.click('#treerefresh')
    pg.wait_for_function("() => document.querySelector('#msg').textContent.includes('removed')", timeout=60000)
    print('after removing:', pg.text_content('#msg'))
    b.close()
print('problems:', problems or 'none')
