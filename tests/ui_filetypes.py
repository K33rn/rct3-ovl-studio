"""File types page: the quick-reference table lists the firework files and links to their entries; a firework file's
summary links to its entry. usage: python tests/ui_filetypes.py <base> <out>"""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1500, 'height': 900})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(base + '/')
    pg.evaluate("localStorage.clear(); [`main`, `mixmaster`, `afe`, `laser-designer`, `jet-designer`].forEach(k => localStorage.setItem(`rct3ovl.tour.` + k, `1`))")
    pg.reload(); pg.wait_for_function("document.getElementById('rootinfo').textContent.includes('OVL pairs')", timeout=180000)
    pg.click('#b-types'); pg.wait_for_selector('#doc .md table')
    rows = pg.eval_on_selector_all('#doc .md table:first-of-type tr td:first-child', 'ts => ts.map(t => t.textContent)')
    links = pg.eval_on_selector_all('#doc .md table:first-of-type td:first-child a', 'as => as.map(a => a.getAttribute("href"))')
    print('quick reference firework rows:', [r for r in rows if r.startswith('.')], '| linked:', [l for l in links if l.split('=')[1] in ('frw', 'fwd', 'las', 'wjt', 'lwr', 'wma')])
    pg.screenshot(path=f'{out}/types_top.png')
    pg.click('#doc .md a[href="#types=fwd"]'); pg.wait_for_timeout(600)
    print('clicked .fwd ->', pg.inner_text('#doc .md h3.hl'))
    pg.screenshot(path=f'{out}/types_fwd.png')
    pg.evaluate("location.hash = '#file=Music%5CBuccaneer.wma'"); pg.wait_for_selector('#doc h2 .help')
    pg.click('#doc h2 .help'); pg.wait_for_timeout(600)
    print('? on a music file ->', pg.inner_text('#doc .md h3.hl'))
    print('errors:', errors)
    b.close()
