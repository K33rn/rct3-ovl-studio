"""File list: the firework files (fireworks, particle effects, shows, lasers, water jets, laser drawings, music) are
listed with the OVLs; each opens a summary and its objects, and opens in the Fireworks tab.
usage: python tests/ui_files.py <base> <out>"""
import os
import sys

from playwright.sync_api import sync_playwright

base, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)


def pick(pg, rel):
    pg.fill('#treefilter', rel.split('\\')[1]); pg.wait_for_timeout(400)
    pg.evaluate('p => [...document.querySelectorAll("#tree .gfile")].find(e => e.dataset.p === "file:" + p).click()', rel)
    pg.wait_for_selector('#doc .gf-btns'); pg.wait_for_timeout(300)


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1500, 'height': 900})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(base + '/')
    pg.evaluate("localStorage.clear(); [`main`, `mixmaster`, `afe`, `laser-designer`, `jet-designer`].forEach(k => localStorage.setItem(`rct3ovl.tour.` + k, `1`))")
    pg.reload(); pg.wait_for_function("document.getElementById('rootinfo').textContent.includes('OVL pairs')", timeout=180000)
    print('root info:', pg.inner_text('#rootinfo'))
    print('file entries in the tree:', pg.eval_on_selector_all('#tree .gfile', 'es => es.length'))
    pg.screenshot(path=f'{out}/tree.png')
    for rel, shot in (('Fireworks\\GreenPeony.frw', 'frw'), ('ParticleEffects\\Mist.frw', 'effect'), ('FireworkDisplays\\Stratosphere.fwd', 'fwd'),
                      ('Lasers\\CrabLaser.las', 'las'), ('WaterJets\\Sprinkler.wjt', 'wjt'), ('LaserWriting\\Crab.lwr', 'lwr'), ('Music\\Buccaneer.wma', 'music')):
        pick(pg, rel)
        print(shot, '|', pg.inner_text('#ovlsub'), '|', pg.inner_text('#doc table').replace('\n', ' | ').replace('\t', ': ')[:260],
              '| buttons:', pg.eval_on_selector_all('#doc .gf-btns button', 'bs => bs.map(b => b.textContent)'))
        pg.screenshot(path=f'{out}/{shot}.png')
    pick(pg, 'Fireworks\\GreenPeony.frw')
    pg.click('#res .res[data-o]'); print('object view:', pg.inner_text('#doc h2'))
    pg.click('#res .res[data-gsum]')
    pg.click('#doc button[data-gf="preview"]'); pg.wait_for_selector('#fw .fwk.sel', timeout=180000); pg.wait_for_timeout(1500)
    print('preview -> palette selection:', pg.inner_text('#fw .fwk.sel .nm'), '| particles:', pg.evaluate('window.__fwdebug.count()'))
    pg.screenshot(path=f'{out}/frw_preview.png')
    pg.click('#fw-back'); pg.wait_for_timeout(500); print('back to:', pg.evaluate('location.hash'))
    pick(pg, 'ParticleEffects\\Mist.frw')
    pg.click('#doc button[data-gf="preview"]'); pg.wait_for_timeout(2500)
    print('effect preview particles:', pg.evaluate('window.__fwdebug.count()'))
    pg.click('#fw-back'); pg.wait_for_timeout(400)
    pick(pg, 'ParticleEffects\\Mist.frw')
    pg.click('#doc button[data-gf="edit"]'); pg.wait_for_selector('#fw .afe-tree .afe-node', timeout=60000); pg.wait_for_timeout(1000)
    print('effect in the AFE, nodes:', pg.eval_on_selector_all('#fw .afe-tree .afe-node', 'es => es.length'))
    pg.screenshot(path=f'{out}/effect_afe.png')
    pg.click('#fw .afe-top button[data-a="close"]'); pg.wait_for_timeout(400); pg.click('#fw-back'); pg.wait_for_timeout(400)
    pick(pg, 'FireworkDisplays\\Stratosphere.fwd')
    pg.click('#doc button[data-gf="open"]'); pg.wait_for_timeout(2500)
    print('show opened:', pg.eval_on_selector('#fw-show', 'e => e.options[e.selectedIndex].text'), '| launches:', pg.eval_on_selector_all('#fw .ent', 'es => es.length'))
    pg.click('#fw-back'); pg.wait_for_timeout(400)
    pick(pg, 'WaterJets\\Sprinkler.wjt')
    pg.click('#doc button[data-gf="edit"]'); pg.wait_for_selector('#fw .fwd-win', timeout=60000)
    print('jet designer opened:', pg.inner_text('#fw .fwd-win header')[:60].replace('\n', ' '))
    print('errors:', errors[:6])
    b.close()
