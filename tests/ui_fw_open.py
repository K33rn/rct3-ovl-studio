"""Open firework / laser / water jet files from anywhere in the MixMaster (Open… button) and check they are added to
your effects and preview. usage: python tests/ui_fw_open.py http://127.0.0.1:8792 file.frw [file.las ...]
(adds them to ~/.rct3ovl/my_effects.json - start the viewer with a scratch cache or remove them afterwards)"""
import os
import sys

from playwright.sync_api import sync_playwright

base, files = sys.argv[1], sys.argv[2:]
problems = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    pg = b.new_page(viewport={'width': 1400, 'height': 900})
    pg.on('pageerror', lambda e: problems.append(f'pageerror {e}'))
    pg.add_init_script("try { localStorage.setItem('rct3ovl.tour.mixmaster', '1'); } catch (e) {}")
    pg.goto(base + '/#fireworks')
    pg.wait_for_selector('#fw .fwk', timeout=180000); pg.wait_for_timeout(1500)
    for f in files:
        name = os.path.basename(f)
        pg.evaluate("() => { const D = window.__fwdebug; D.parts().length = 0; }")
        pg.set_input_files('#fw-file', f)
        pg.wait_for_function("n => document.querySelector('#fw-toast')?.textContent.includes(n)", arg=name, timeout=30000)
        toast = pg.text_content('#fw-toast')
        pg.wait_for_timeout(1500)
        info = pg.evaluate("""n => { const D = window.__fwdebug; const hits = [];
            for (const k of ['firework', 'laser', 'jet']) for (const [key, d] of Object.entries(D.REG[k])) if (d.file === n && key.startsWith('my:')) hits.push(k + ' ' + key + ' ' + d.title);
            const sel = document.querySelector('#fw-lib .fwk.sel');
            return { hits, sel: sel ? sel.textContent.trim().slice(0, 40) : null, parts: D.count() }; }""", name)
        print(name, '|', toast, '|', info)
        if 'Could not' in toast or not info['hits'] or not info['sel']:
            problems.append(f'{name}: {toast} {info}')
        if name.lower().endswith('.frw') and not info['parts']:
            problems.append(f'{name}: no particles in the preview')
    b.close()
print('problems:', problems or 'none')
