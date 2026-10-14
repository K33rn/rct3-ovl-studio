"""'Neon Nights' front screen for RCT3: every front-screen texture redrawn (night sky, neon glows, new icons, logo
and art). Reads the originals from <src>, writes same-size PNGs to <out>. The layout's shapes (alpha) are kept so the
pieces still meet where the game puts them."""
import math, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops

src, out = sys.argv[1], sys.argv[2]
random.seed(7)
PINK, CYAN, YEL, PURP, ORNG = (255, 43, 214), (34, 230, 255), (255, 225, 77), (150, 70, 255), (255, 140, 40)
F = lambda n, s: ImageFont.truetype(n, s)


def load(n):
    return Image.open(f'{src}/{n}.png').convert('RGBA')


def glow(size, draw_fn, color, radius=(10, 5, 2), core=(255, 255, 255), width=4, core_w=None):
    """Neon: the shape blurred in colour at a few radii, then a pale core on top."""
    L = Image.new('RGBA', size, (0, 0, 0, 0))
    m = Image.new('L', size, 0); draw_fn(ImageDraw.Draw(m), 255, width)
    for r in radius:
        b = m.filter(ImageFilter.GaussianBlur(r)).point(lambda v: min(255, v * 2))
        L.alpha_composite(Image.merge('RGBA', [Image.new('L', size, c) for c in color] + [b]))
    m2 = Image.new('L', size, 0); draw_fn(ImageDraw.Draw(m2), 255, core_w or max(1, width // 2))
    L.alpha_composite(Image.merge('RGBA', [Image.new('L', size, c) for c in core] + [m2]))
    return L


# ---- the night behind it all: one 1024 x 768 picture (the screen's layout), cut up for each piece ----------------
def night():
    W, H = 1024, 768
    y = np.linspace(0, 1, H)[:, None]
    top, mid, bot = np.array([8, 4, 28]), np.array([40, 10, 80]), np.array([110, 20, 110])
    g = np.where(y < 0.65, top + (mid - top) * (y / 0.65), mid + (bot - mid) * ((y - 0.65) / 0.35))
    im = Image.fromarray(np.repeat(g[:, None, :], W, 1).reshape(H, W, 3).astype(np.uint8)).convert('RGBA')
    d = ImageDraw.Draw(im)
    for _ in range(420):                                  # stars
        x, yy = random.randrange(W), random.randrange(int(H * 0.7)); b = random.randint(90, 255); s = random.random()
        d.ellipse((x, yy, x + (2 if s > 0.93 else 1), yy + (2 if s > 0.93 else 1)), fill=(b, b, min(255, b + 30), 255))
    # a synthwave sun low on the left, striped
    sun = Image.new('RGBA', (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(sun)
    cx, cy, r = 250, 560, 150
    for i in range(r * 2):
        t = i / (r * 2); col = tuple(int(a + (b - a) * t) for a, b in zip(YEL, PINK))
        yy = cy - r + i
        if yy > cy - 20 and (yy - cy) % 18 < 3 + (yy - cy) // 12: continue
        hw = math.sqrt(max(0, r * r - (yy - cy) ** 2)); sd.line((cx - hw, yy, cx + hw, yy), fill=col + (255,))
    halo = sun.filter(ImageFilter.GaussianBlur(30)); im.alpha_composite(halo); im.alpha_composite(sun)
    # city skyline in front of the sun
    sk = Image.new('RGBA', (W, H), (0, 0, 0, 0)); kd = ImageDraw.Draw(sk); x = 0
    while x < W:
        w = random.randint(18, 46); h = random.randint(30, 140); kd.rectangle((x, 640 - h, x + w, 640), fill=(14, 6, 30, 255))
        for wy in range(640 - h + 8, 636, 10):
            for wx in range(x + 4, x + w - 4, 8):
                if random.random() < 0.25: kd.rectangle((wx, wy, wx + 2, wy + 3), fill=random.choice([YEL, CYAN, PINK]) + (255,))
        x += w + random.randint(0, 6)
    im.alpha_composite(sk)
    # neon floor grid below the horizon
    gr = Image.new('RGBA', (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(gr)
    hz, vx = 640, 512
    for i in range(-30, 31):
        gd.line((vx + i * 12, hz, vx + i * 150, H + 200), fill=PINK + (200,), width=2)
    k = 1.0
    while hz + k < H:
        gd.line((0, hz + k, W, hz + k), fill=PINK + (200,), width=2); k *= 1.45
    im.alpha_composite(gr.filter(ImageFilter.GaussianBlur(3))); im.alpha_composite(gr)
    return im


SKY = night()


def restyle(n, at, thick_pale=False):
    """A background piece: its opaque coloured band -> the night (cut from where the piece sits, `at`: list of
    (src box, screen xy)); its see-through veil -> dark violet glass with scan lines; its thin white rings -> pink neon;
    thick white (title pills) -> pale with a cyan rim, so the game's black text stays readable."""
    o = load(n); a = np.array(o).astype(int); A = a[..., 3]
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    pale = (r > 200) & (g > 200) & (b > 200)
    white = (A >= 215) & pale                       # rings and title pills (their rows alternate 221-255)
    veil = (A > 0) & (A < 215) & pale               # the see-through grey band
    dark = (A > 0) & (r < 60) & (g < 60) & (b < 60)  # the line in the title pill
    bar = (A > 0) & ~pale & ~dark & (b > 200)        # the light blue bar under the title
    band = (A > 0) & ~pale & ~dark & ~bar
    sky = Image.new('RGBA', o.size, (0, 0, 0, 0))
    for (x0, y0, x1, y1), (sx, sy) in at:
        sky.paste(SKY.crop((sx, sy, sx + x1 - x0, sy + y1 - y0)), (x0, y0))
    res = np.zeros_like(a)
    res[band] = np.array(sky)[band]
    # veil: violet glass, a diagonal sheen
    yy, xx = np.mgrid[0:o.size[1], 0:o.size[0]]
    shade = (((xx + yy) // 6) % 2) * 10 + (yy % 3 == 0) * 12
    res[veil, 0] = 50 + shade[veil]; res[veil, 1] = 14 + shade[veil] // 2; res[veil, 2] = 90 + shade[veil]
    res[veil, 0] += 20; res[veil, 2] += 30
    res[veil, 3] = 150
    # the bar under the title: a violet-to-pink gradient with a cyan line along its top
    t = np.clip(xx / o.size[0], 0, 1)
    res[bar, 0] = (90 + 150 * t[bar]); res[bar, 1] = 20; res[bar, 2] = (200 - 60 * t[bar]); res[bar, 3] = 255
    edge = bar & ~np.roll(bar, 2, 0)
    res[edge] = (*CYAN, 255)
    wm = Image.fromarray(((white | dark) * 255).astype(np.uint8))
    if thick_pale:      # thick white = title pills: survive a 31 px erosion, then grow back inside the white
        th = wm.filter(ImageFilter.MinFilter(31))
        for _ in range(18):
            th = ImageChops.multiply(th.filter(ImageFilter.MaxFilter(3)), wm)
        thick = np.array(th) > 0
    else:
        thick = np.zeros_like(white)
    thick &= white
    thin = white & ~thick
    res[thin] = (*PINK, 255)
    res[thick] = (250, 246, 255, 255)
    res[dark] = (*PINK, 255)
    im = Image.fromarray(res.astype(np.uint8))
    # neon glow along the pink rings (inside the piece's own shape only)
    pm = Image.fromarray((thin * 255).astype(np.uint8))
    halo = pm.filter(ImageFilter.GaussianBlur(6)).point(lambda v: min(255, v * 3))
    gl = Image.merge('RGBA', [Image.new('L', o.size, c) for c in PINK] + [ImageChops.multiply(halo, Image.fromarray(np.where(thin, 0, A).astype(np.uint8)))])
    base = im.copy(); base.alpha_composite(gl); base.alpha_composite(Image.fromarray(np.where(thin[..., None], res, 0).astype(np.uint8)))
    # pale pills get a cyan rim
    if thick.any():
        tm = Image.fromarray((thick * 255).astype(np.uint8))
        rim = ImageChops.subtract(tm, tm.filter(ImageFilter.MinFilter(5)))
        base.alpha_composite(Image.merge('RGBA', [Image.new('L', o.size, c) for c in CYAN] + [rim]))
    # keep the original's shape exactly
    out_a = np.array(base)[..., 3]; out_a[A == 0] = 0
    arr = np.array(base); arr[..., 3] = np.where(A == 0, 0, np.maximum(out_a, np.where(veil, res[..., 3], A)))
    return Image.fromarray(arr)


def save(im, n):
    im.save(f'{out}/{n}.png')


save(restyle('FrontEndBG1', [((0, 0, 512, 512), (0, 0))]), 'FrontEndBG1')
save(restyle('FrontEndBG1b', [((0, 0, 512, 512), (0, 0))]), 'FrontEndBG1b')
save(restyle('FrontEndBG2', [((0, 0, 512, 256), (0, 512)), ((0, 256, 512, 512), (512, 512))], thick_pale=True), 'FrontEndBG2')
save(restyle('FrontEndBG3', [((0, 0, 512, 512), (512, 0))]), 'FrontEndBG3')
save(restyle('FrontEndBG4', [((0, 0, 512, 512), (400, 0))]), 'FrontEndBG4')


# ---- FrontEndParts: icon discs, button-bar ends, the logo, the crowd ---------------------------------------------
P = load('FrontEndParts'); Pa = np.array(P); PA = Pa[..., 3]
parts = Image.new('RGBA', P.size, (0, 0, 0, 0))


def disc(box, ring):
    x0, y0, x1, y1 = box; w, h = x1 - x0, y1 - y0
    # a hexagon badge instead of the round disc (the game only draws the picture; its shape is the alpha)
    m = Image.new('L', (w, h), 0); cx, cy, R = w / 2, h / 2, w / 2 - 1
    ImageDraw.Draw(m).polygon([(cx + R * math.cos(math.pi / 6 + k * math.pi / 3), cy + R * math.sin(math.pi / 6 + k * math.pi / 3)) for k in range(6)], fill=255)
    g = np.zeros((h, w, 4), np.uint8); yy, xx = np.mgrid[0:h, 0:w]
    rr = np.hypot(xx - w / 2, yy - h / 2) / (w / 2)
    g[..., 0] = np.clip(20 + 40 * (1 - rr), 0, 255); g[..., 1] = np.clip(6 + 10 * (1 - rr), 0, 255); g[..., 2] = np.clip(50 + 70 * (1 - rr), 0, 255); g[..., 3] = 255
    d = Image.fromarray(g)
    e = m.filter(ImageFilter.MinFilter(7)); rim = ImageChops.subtract(m, e)
    d.alpha_composite(Image.merge('RGBA', [Image.new('L', (w, h), c) for c in ring] + [rim.filter(ImageFilter.GaussianBlur(1.5)).point(lambda v: min(255, v * 2))]))
    d.putalpha(m)
    parts.paste(d, (x0, y0))


disc((2, 2, 89, 89), PINK)                 # Circle: behind the menu icons
disc((186, 2, 264, 82), CYAN)              # IconCircle_New
# button-bar end (half disc) and the triangle: bright neon cyan with a pink edge
for box in [(90, 2, 185, 99), (2, 95, 97, 180)]:
    x0, y0, x1, y1 = box; w, h = x1 - x0, y1 - y0
    m = Image.fromarray(PA[y0:y1, x0:x1].astype(np.uint8))
    yy = np.linspace(0, 1, h)[:, None]
    g = np.zeros((h, w, 4), np.uint8)
    g[..., 0] = 40; g[..., 1] = 240; g[..., 2] = 255; g[..., 3] = 255   # flat neon cyan = the bar colour patched into the exe (0xff28f0ff)
    d = Image.fromarray(g)
    edge = ImageChops.subtract(m, m.filter(ImageFilter.MinFilter(7)))
    d.alpha_composite(Image.merge('RGBA', [Image.new('L', (w, h), c) for c in PINK] + [edge]))
    d.putalpha(m); parts.paste(d, (x0, y0))


def neon_text(size, text, font, color, xy, anchor='mm', stroke=3):
    def fn(dr, v, w):
        dr.text(xy, text, font=font, fill=v, anchor=anchor, stroke_width=w, stroke_fill=v)
    return glow(size, fn, color, radius=(9, 4), width=stroke, core_w=0)


# logo: RCT3 in pink neon, NEON NIGHTS in cyan, on a dark plate (237 x 140)
L = Image.new('RGBA', (237, 140), (0, 0, 0, 0)); ld = ImageDraw.Draw(L)
ld.rounded_rectangle((4, 4, 232, 135), 18, fill=(16, 6, 36, 235))
L.alpha_composite(glow((237, 140), lambda dr, v, w: dr.rounded_rectangle((6, 6, 230, 133), 16, outline=v, width=w), CYAN, radius=(4, 2), width=3))
L.alpha_composite(neon_text((237, 140), 'RCT3', F('impact.ttf', 72), PINK, (118, 58), stroke=2))
L.alpha_composite(neon_text((237, 140), 'NEON NIGHTS', F('bahnschrift.ttf', 25), CYAN, (118, 112), stroke=1))
parts.paste(Image.new('RGBA', (237, 140), (0, 0, 0, 0)), (275, 0)); parts.alpha_composite(L, (275, 0))


# ---- neon line art -------------------------------------------------------------------------------------------
def coaster(size, scale=1.0, ox=0, oy=0):
    """A neon roller coaster: a lift hill, a big loop and a run-out, a train on the hill, supports."""
    W, H = size
    pts = []
    s = scale
    def P(x, y): return (ox + x * s, oy + y * s)
    for t in np.linspace(0, 1, 40): pts.append(P(10 + 120 * t, 460 - 330 * t ** 1.4))          # lift hill
    for t in np.linspace(0, 1, 30): pts.append(P(130 + 50 * t, 130 - 40 * math.sin(t * math.pi)))
    for t in np.linspace(0, 1, 40): pts.append(P(180 + 60 * t, 130 + 300 * t ** 1.2))          # drop
    for t in np.linspace(0, 1, 10): pts.append(P(240 + 60 * t, 430))
    cx, cy, R = 300, 330, 100                                                                     # the loop
    for t in np.linspace(0, 1, 90):
        th = t * 2 * math.pi
        pts.append(P(cx + R * math.sin(th) + 60 * t, cy + R * math.cos(th)))
    for t in np.linspace(0, 1, 30): pts.append(P(360 + 140 * t, 430))
    track = lambda dr, v, w: dr.line(pts, fill=v, width=w, joint='curve')
    rail2 = [(x, y + 9 * s) for x, y in pts]
    img = Image.new('RGBA', size, (0, 0, 0, 0))
    sup = lambda dr, v, w: [dr.line((x, y + 10 * s, x, oy + 470 * s), fill=v, width=w) for i, (x, y) in enumerate(pts) if i % 9 == 0 and y < oy + 440 * s]
    img.alpha_composite(glow(size, sup, PURP, radius=(5, 2), width=max(2, int(4 * s)), core=(200, 160, 255)))
    img.alpha_composite(glow(size, track, CYAN, radius=(12, 5, 2), width=max(2, int(6 * s))))
    img.alpha_composite(glow(size, lambda dr, v, w: dr.line(rail2, fill=v, width=w, joint='curve'), PINK, radius=(8, 3), width=max(2, int(4 * s))))
    # a train of 4 cars on the lift hill
    for k in range(4):
        i = 10 + k * 5; (x, y), (x2, y2) = pts[i], pts[i + 4]
        ang = math.atan2(y2 - y, x2 - x)
        car = Image.new('RGBA', (int(40 * s), int(26 * s)), (0, 0, 0, 0))
        cd = ImageDraw.Draw(car); cd.rounded_rectangle((1, 1, car.width - 2, car.height - 2), int(6 * s), fill=YEL + (255,), outline=(255, 255, 255, 255), width=2)
        car = car.rotate(-math.degrees(ang), expand=True, resample=Image.BICUBIC)
        gl = car.filter(ImageFilter.GaussianBlur(5))
        img.alpha_composite(gl, (int(x - car.width / 2), int(y - car.height + 4 * s)))
        img.alpha_composite(car, (int(x - car.width / 2), int(y - car.height + 4 * s)))
    return img


# FrontEndLogo (the main menu's big picture, where the two kids were; drawn in the bottom-left corner, from y ~310 of
# 800): a giant neon ferris wheel with the coaster running in front and an OPEN sign
logo = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
cx, cy, R = 250, 250, 205
wheel = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
wheel.alpha_composite(glow((512, 512), lambda dr, v, w: (dr.line((cx, cy, cx - 120, 505), fill=v, width=w), dr.line((cx, cy, cx + 120, 505), fill=v, width=w)), PURP, radius=(8, 3), width=9))
wheel.alpha_composite(glow((512, 512), lambda dr, v, w: [dr.line((cx, cy, cx + R * math.cos(a), cy + R * math.sin(a)), fill=v, width=w) for a in np.linspace(0, 2 * math.pi, 17)[:-1]], CYAN, radius=(6, 2), width=3))
wheel.alpha_composite(glow((512, 512), lambda dr, v, w: (dr.ellipse((cx - R, cy - R, cx + R, cy + R), outline=v, width=w), dr.ellipse((cx - R + 22, cy - R + 22, cx + R - 22, cy + R - 22), outline=v, width=w)), PINK, radius=(12, 5, 2), width=6))
wheel.alpha_composite(glow((512, 512), lambda dr, v, w: dr.ellipse((cx - 34, cy - 34, cx + 34, cy + 34), outline=v, width=w), YEL, radius=(8, 3), width=6))
for k, a in enumerate(np.linspace(0, 2 * math.pi, 17)[:-1]):
    x, y = cx + R * math.cos(a), cy + R * math.sin(a); col = [YEL, CYAN, ORNG, PINK][k % 4]
    wheel.alpha_composite(glow((512, 512), lambda dr, v, w: dr.rounded_rectangle((x - 15, y + 2, x + 15, y + 28), 6, outline=v, width=w), col, radius=(5, 2), width=4))
logo.alpha_composite(wheel)
logo.alpha_composite(coaster((512, 512), 0.82, 10, 105))
sign = Image.new('RGBA', (512, 512), (0, 0, 0, 0)); sd = ImageDraw.Draw(sign)
sd.rounded_rectangle((4, 4, 176, 70), 14, fill=(20, 6, 40, 230))
sign.alpha_composite(glow((512, 512), lambda dr, v, w: dr.rounded_rectangle((4, 4, 176, 70), 14, outline=v, width=w), PINK, radius=(6, 3), width=4))
sign.alpha_composite(neon_text((512, 512), 'OPEN', F('impact.ttf', 46), YEL, (90, 36), stroke=2))
sign.alpha_composite(neon_text((512, 512), 'ALL NIGHT', F('bahnschrift.ttf', 20), CYAN, (90, 86), stroke=1))
logo.alpha_composite(sign)
save(logo, 'FrontEndLogo')

# the crowd (other menus): a neon ferris wheel
fw = Image.new('RGBA', (280, 312), (0, 0, 0, 0))
cx, cy, R = 140, 150, 115
fw.alpha_composite(glow((280, 312), lambda dr, v, w: (dr.ellipse((cx - R, cy - R, cx + R, cy + R), outline=v, width=w), dr.ellipse((cx - 30, cy - 30, cx + 30, cy + 30), outline=v, width=w)), PINK, width=5))
fw.alpha_composite(glow((280, 312), lambda dr, v, w: [dr.line((cx, cy, cx + R * math.cos(a), cy + R * math.sin(a)), fill=v, width=w) for a in np.linspace(0, 2 * math.pi, 13)[:-1]], CYAN, radius=(5, 2), width=3))
fw.alpha_composite(glow((280, 312), lambda dr, v, w: (dr.line((cx, cy, cx - 70, 305), fill=v, width=w), dr.line((cx, cy, cx + 70, 305), fill=v, width=w)), PURP, width=5))
for a in np.linspace(0, 2 * math.pi, 13)[:-1]:
    x, y = cx + R * math.cos(a), cy + R * math.sin(a)
    fw.alpha_composite(glow((280, 312), lambda dr, v, w: dr.rounded_rectangle((x - 9, y, x + 9, y + 16), 4, outline=v, width=w), YEL, radius=(4, 2), width=3))
parts.paste(Image.new('RGBA', (280, 312), (0, 0, 0, 0)), (0, 200)); parts.alpha_composite(fw, (0, 200))
save(parts, 'FrontEndParts')


# ---- FrontEndIcons: 18 neon glyphs (83 x 83 each) -----------------------------------------------------------
ICONS = {'Play': (1, 1), 'Sandbox': (86, 1), 'Designers': (171, 1), 'Quit': (256, 1), 'Options': (341, 1), 'Career': (426, 1),
         'ScenarioEditor': (1, 86), 'PersonDesigner': (86, 86), 'CoasterEditor': (171, 86), 'Tutorial': (256, 86), 'Save': (341, 86), 'Load': (426, 86),
         'NewScenario': (1, 171), 'StartSandbox': (86, 171), 'BuildingDesigner': (171, 171), 'AOP0': (256, 171), 'RCT3': (341, 171), 'AOP1': (426, 171)}
S = 83


def gear(dr, v, w, cx=41, cy=41, r=24, teeth=8):
    pts = []
    for i in range(teeth * 4):
        a = i / (teeth * 4) * 2 * math.pi; rr = r + (7 if (i // 2) % 2 == 0 else 0)
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    dr.polygon(pts, outline=v, width=w); dr.ellipse((cx - 9, cy - 9, cx + 9, cy + 9), outline=v, width=w)


def star(cx, cy, r, n=5):
    return [(cx + (r if i % 2 == 0 else r * 0.45) * math.cos(-math.pi / 2 + i * math.pi / n), cy + (r if i % 2 == 0 else r * 0.45) * math.sin(-math.pi / 2 + i * math.pi / n)) for i in range(2 * n)]


GLYPH = {
    'Play': (YEL, lambda d, v, w: (d.rounded_rectangle((8, 20, 74, 62), 8, outline=v, width=w), d.polygon([(32, 29), (54, 41), (32, 53)], outline=v, width=w))),
    'Sandbox': (CYAN, lambda d, v, w: (d.polygon([(41, 12), (70, 27), (41, 42), (12, 27)], outline=v, width=w), d.line((12, 27, 12, 57, 41, 72, 70, 57, 70, 27), fill=v, width=w), d.line((41, 42, 41, 72), fill=v, width=w))),
    'Designers': (PINK, lambda d, v, w: (d.line((18, 66, 60, 24), fill=v, width=w + 2), d.polygon([(60, 24), (68, 14), (70, 28)], outline=v, width=w), d.rectangle((12, 60, 70, 70), outline=v, width=w))),
    'Quit': (PINK, lambda d, v, w: (d.arc((16, 18, 66, 68), -60, 240, fill=v, width=w), d.line((41, 10, 41, 40), fill=v, width=w))),
    'Options': (CYAN, gear),
    'Career': (YEL, lambda d, v, w: (d.arc((22, 10, 60, 48), 0, 180, fill=v, width=w), d.line((22, 29, 60, 29), fill=v, width=w), d.line((41, 48, 41, 62), fill=v, width=w), d.rectangle((26, 62, 56, 70), outline=v, width=w))),
    'ScenarioEditor': (PINK, lambda d, v, w: (d.ellipse((24, 10, 58, 44), outline=v, width=w), d.line((28, 38, 41, 68, 54, 38), fill=v, width=w), d.ellipse((36, 22, 46, 32), outline=v, width=w))),
    'PersonDesigner': (CYAN, lambda d, v, w: (d.ellipse((30, 10, 52, 32), outline=v, width=w), d.arc((16, 36, 66, 90), 180, 360, fill=v, width=w))),
    'CoasterEditor': (YEL, lambda d, v, w: (d.line((6, 66, 24, 20, 40, 60, 58, 18, 76, 62), fill=v, width=w, joint='curve'),)),
    'Tutorial': (PINK, lambda d, v, w: (d.arc((22, 10, 60, 46), 200, 400, fill=v, width=w), d.line((41, 46, 41, 56), fill=v, width=w), d.ellipse((38, 64, 44, 70), fill=v))),
    'Save': (CYAN, lambda d, v, w: (d.rectangle((14, 14, 68, 68), outline=v, width=w), d.rectangle((26, 14, 56, 32), outline=v, width=w), d.rectangle((24, 46, 58, 68), outline=v, width=w))),
    'Load': (YEL, lambda d, v, w: (d.line((10, 24, 32, 24, 38, 30, 72, 30, 72, 66, 10, 66, 10, 24), fill=v, width=w), d.line((30, 48, 52, 48), fill=v, width=w), d.line((44, 40, 52, 48, 44, 56), fill=v, width=w))),
    'NewScenario': (PINK, lambda d, v, w: (d.polygon(star(41, 42, 30), outline=v, width=w),)),
    'StartSandbox': (CYAN, lambda d, v, w: (d.polygon([(28, 16), (66, 41), (28, 66)], outline=v, width=w),)),
    'BuildingDesigner': (YEL, lambda d, v, w: (d.polygon([(41, 12), (70, 36), (12, 36)], outline=v, width=w), d.rectangle((18, 36, 64, 68), outline=v, width=w), d.rectangle((34, 48, 48, 68), outline=v, width=w))),
    'AOP0': (CYAN, lambda d, v, w: [d.arc((6 + k * 22, 26 + (k % 2) * 4, 34 + k * 22, 56 + (k % 2) * 4), 180, 360, fill=v, width=w) for k in range(3)] + [d.line((6, 62, 76, 62), fill=v, width=w)]),
    'RCT3': (PINK, lambda d, v, w: d.text((41, 41), '3', font=F('impact.ttf', 58), fill=v, anchor='mm', stroke_width=w // 2, stroke_fill=v)),
    'AOP1': (ORNG, lambda d, v, w: (d.ellipse((26, 36, 56, 66), outline=v, width=w), *[d.ellipse((x - 7, y - 7, x + 7, y + 7), outline=v, width=w) for x, y in ((18, 30), (32, 16), (50, 16), (64, 30))])),
}
icons = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
for n, (x, y) in ICONS.items():
    col, fn = GLYPH[n]
    icons.alpha_composite(glow((S, S), lambda d, v, w: fn(d, v, w), col, radius=(6, 3, 1), width=5, core_w=2), (x, y))
save(icons, 'FrontEndIcons')


# ---- a preview of the main menu as the game lays it out (1024 x 768) -------------------------------------------
pv = Image.new('RGBA', (1024, 768), (90, 120, 90, 255))           # green = the game's 3D park would show here
pv.alpha_composite(Image.open(f'{out}/FrontEndBG1.png'), (0, 0))
b2 = Image.open(f'{out}/FrontEndBG2.png'); pv.alpha_composite(b2.crop((0, 0, 512, 256)), (0, 512)); pv.alpha_composite(b2.crop((0, 257, 512, 512)), (512, 512))
pv.alpha_composite(logo.resize((300, 300)), (20, 400))
pv.alpha_composite(L, (20, 10))
for i, n in enumerate(['Play', 'Designers', 'Options']):
    pv.alpha_composite(parts.crop((2, 2, 89, 89)), (45, 115 + i * 88)); pv.alpha_composite(icons.crop((ICONS[n][0], ICONS[n][1], ICONS[n][0] + S, ICONS[n][1] + S)), (47, 117 + i * 88))
pv.save(f'{out}/preview.png')


# ---- GUI2Main2: the expansion badges (bottom right of the front screen): Soaked! -> a neon wave, Wild! -> a paw ------
g2 = load('GUI2Main2')
for (x0, y0), col, fn, label in [((320, 0), CYAN, GLYPH['AOP0'][1], 'SOAKED'), ((320, 100), ORNG, GLYPH['AOP1'][1], 'WILD')]:
    b = Image.new('RGBA', (100, 100), (0, 0, 0, 0)); bd = ImageDraw.Draw(b)
    bd.ellipse((4, 4, 96, 96), fill=(22, 8, 46, 255))
    b.alpha_composite(glow((100, 100), lambda d, v, w: d.ellipse((5, 5, 95, 95), outline=v, width=w), PINK, radius=(4, 2), width=4))
    gly = glow((S, S), lambda d, v, w: fn(d, v, w), col, radius=(4, 2), width=4, core_w=2).resize((62, 62))
    b.alpha_composite(gly, (19, 12))
    b.alpha_composite(neon_text((100, 100), label, F('bahnschrift.ttf', 15), col, (50, 80), stroke=1))
    g2.paste(b, (x0, y0))
save(g2, 'GUI2Main2')
