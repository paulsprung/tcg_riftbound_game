#!/usr/bin/env python3
"""Draws the wrappers of the shop's special packs (src/economy/products.ts) in
the look of Riot's boosters, into public/media/pack-<id>.webp.

    python3 scripts/special-packs.py      (needs opencv-python, numpy, fonttools, brotli)

A booster is a foil bag in one colour, crimped top and bottom, with the
Riftbound logo at the top, a gold frame down the sides, the champion in the
middle and the set's name over "14-CARD BOOSTER" at the foot. These are
built the same way:

- the bag's outline and the ribs of its crimps come from the Vendetta pack,
  the colour from the special pack's own wrapper colours;
- the logo is Riot's own Riftbound logo (the one on riftbound.leagueoflegends.com),
  its RIFTBOUND / LEAGUE OF LEGENDS part, with 14+ under it as on the packs;
- the champion is the art of one of the pack's own cards (public/cards);
- the name is set in the app's display face, Faustina, in gold.

Then src/data/media.json gets the pack entries, so the app shows them as it
shows the boosters (PackWrapper's real art, tear line included).
"""
import json
import os
import urllib.request

import cv2
import numpy as np
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA = os.path.join(ROOT, 'public', 'media')
CARDS = os.path.join(ROOT, 'public', 'cards')
MANIFEST = os.path.join(ROOT, 'src', 'data', 'media.json')
FONTS = os.path.join(ROOT, 'node_modules', '@fontsource-variable')
TMP = os.path.join(ROOT, 'node_modules', '.cache', 'special-packs')

W, H = 552, 900          # the Vendetta pack's size
TEAR = 0.0515            # its tear line
LOGO_TOP = 68

# id: name lines, the line under them, the card whose art it shows and the part of that card to use
# (x0, y0, x1, y1 on the 744 x 1039 scan, clear of its cost and its text), wrapper colours light, mid, dark
PACKS = {
    't1': {'title': 'T1 WORLDS', 'sub': '1-CARD PACK', 'card': 't1s-003-005', 'crop': (40, 96, 744, 600),
           'colors': ('#ff3a4c', '#a8001c', '#1a0508')},
    'arcane': {'title': 'ARCANE', 'sub': '1-CARD PACK', 'card': 'pr-202-298', 'crop': (130, 70, 744, 620),
               'colors': ('#f5c862', '#8a5a14', '#20140a')},
    'secret-garden': {'title': 'SECRET GARDEN', 'sub': '1 CARD + 1 TOKEN', 'card': 'sgn-001-003', 'crop': (150, 36, 744, 660),
                      'colors': ('#d9f08a', '#4f8f3a', '#16301a')},
    'gift-of-the-rift': {'title': 'GIFT OF THE RIFT', 'sub': 'BOOSTER + PROMO CHANCE', 'card': 'pr-139a-166', 'crop': (130, 60, 744, 640),
                         'colors': ('#78e2d6', '#13707a', '#06222a')},
}


def hex_bgr(h):
    h = h.lstrip('#')
    return np.array([int(h[4:6], 16), int(h[2:4], 16), int(h[0:2], 16)], float)


def font(family, file, weight):
    """A static TTF of one of the app's variable fonts, for Pillow."""
    os.makedirs(TMP, exist_ok=True)
    out = os.path.join(TMP, f'{family}-{weight}.ttf')
    if not os.path.exists(out):
        f = TTFont(os.path.join(FONTS, family, 'files', file))
        f.flavor = None
        instancer.instantiateVariableFont(f, {'wght': weight}).save(out)
    return out


# Riot's Riftbound logo, as riftbound.leagueoflegends.com shows it (a 10000 x 4389 PNG with alpha); fetched once
LOGO_URL = ('https://cmsassets.rgpub.io/sanity/images/dsfx7636/news/'
            '23d41c7809a48a013f3d8a7204b81fb4d8bdb164-10000x4389.png?accountingTag=RB&w=1600')
LOGO_WORDS = 526     # at that width, the rows of RIFTBOUND / LEAGUE OF LEGENDS (the band under them says TRADING CARD GAME)
LOGO_W = 404         # its width on the pack, as on the boosters


def logo():
    """The Riftbound logo's words, as BGR and alpha, at their size on the pack."""
    os.makedirs(TMP, exist_ok=True)
    path = os.path.join(TMP, 'riftbound-logo.png')
    if not os.path.exists(path):
        urllib.request.urlretrieve(LOGO_URL, path)
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)[:LOGO_WORDS]
    h = round(img.shape[0] * LOGO_W / img.shape[1])
    img = cv2.resize(img, (LOGO_W, h), interpolation=cv2.INTER_AREA)
    return img[..., :3].astype(float), img[..., 3].astype(float) / 255


def background(c1, c2, c3, rng):
    """The foil: the mid colour, lighter at the top and behind the champion, darker at the foot,
    with soft streaks of light and a scatter of shards, as on the boosters."""
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    t = yy / H
    top, mid, bot = c2 * .55 + c1 * .45, c2, c2 * .45 + c3 * .55
    base = np.where((t < .5)[..., None], top + (mid - top) * (t / .5)[..., None], mid + (bot - mid) * ((t - .5) / .5)[..., None])
    glow = np.exp(-(((xx - W * .5) / (W * .42)) ** 2 + ((yy - H * .45) / (H * .3)) ** 2))[..., None]
    img = base * (1 - .55 * glow) + c1 * .55 * glow
    # streaks of light falling from the top left
    streak = np.zeros((H, W))
    for k in range(5):
        x = rng.uniform(-.2, 1.1) * W
        d = (xx - x) * np.cos(.5) - (yy * .55) * np.sin(.5)
        streak += np.exp(-(d / rng.uniform(14, 40)) ** 2) * rng.uniform(.05, .12)
    img = img + 255 * streak[..., None] * (1 - t[..., None] * .8)
    # shards
    layer = np.zeros((H, W, 3))
    alpha = np.zeros((H, W))
    for _ in range(46):
        cx, cy = rng.uniform(0, W), rng.uniform(40, H - 60)
        s = rng.uniform(3, 11)
        ang = rng.uniform(0, np.pi)
        pts = np.array([[cx + s * np.cos(ang + q), cy + s * .45 * np.sin(ang + q) * (1.8 if q % np.pi else 1)] for q in (0, np.pi / 2, np.pi, 3 * np.pi / 2)], np.int32)
        col = c1 * .6 + 255 * .4
        cv2.fillConvexPoly(layer, pts, col.tolist(), cv2.LINE_AA)
        cv2.fillConvexPoly(alpha, pts, rng.uniform(.25, .6), cv2.LINE_AA)
    alpha = cv2.GaussianBlur(alpha, (0, 0), .7)
    img = img * (1 - alpha[..., None]) + layer * alpha[..., None]
    return np.clip(img, 0, 255)


def crimps(img, ven):
    """The ribs of the crimped ends, from the Vendetta pack's own, on this colour."""
    lum = cv2.cvtColor(ven, cv2.COLOR_BGR2GRAY).astype(float)
    hp = lum - cv2.GaussianBlur(lum, (0, 0), 9)
    shade = cv2.GaussianBlur(lum, (0, 0), 25)
    for y0, y1 in ((0, 50), (848, H)):
        band = slice(y0, y1)
        k = np.clip(hp[band] / 60, -.5, .5)[..., None]
        s = (shade[band] / max(shade[band].mean(), 1))[..., None]
        img[band] = img[band] * (.82 + .18 * s) * (1 + k)
        # the seam where the crimp meets the bag
        edge = y1 - 2 if y0 == 0 else y0
        img[edge:edge + 2] *= .7
    return img


def art(card, crop):
    """The champion over the whole width of the bag, as on the boosters: fading into the foil under
    the logo, and darkening into the foot, where the name stands on it."""
    scan = cv2.imread(os.path.join(CARDS, f'{card}.webp'))
    x0, y0, x1, y1 = crop
    a = scan[y0:y1, x0:x1]
    wx0, wy0, wx1, wy1 = 0, 120, W, 848
    tw, th = wx1 - wx0, wy1 - wy0
    s = max(tw / a.shape[1], th / a.shape[0])
    a = cv2.resize(a, (round(a.shape[1] * s), round(a.shape[0] * s)), interpolation=cv2.INTER_AREA)
    ox, oy = (a.shape[1] - tw) // 2, (a.shape[0] - th) // 4
    a = a[oy:oy + th, ox:ox + tw]
    yy = np.linspace(0, 1, th)[:, None]
    xx = np.linspace(-1, 1, tw)[None, :]
    # in under the logo, out at the foot; a little softer at the very sides, where the bag curves away
    m = np.clip((yy - .03) / .17, 0, 1) * np.clip((1 - yy) / .1, 0, 1) * (1 - .25 * np.abs(xx) ** 6)
    return a.astype(float), m.astype(np.float32), (wx0, wy0)


GOLD, GOLD_HI, GOLD_EDGE = (232, 196, 116, 255), (255, 238, 190, 255), (50, 28, 6, 210)


def gold_line(draw, pts, width=3):
    draw.line(pts, fill=GOLD_EDGE, width=width + 3, joint='curve')
    draw.line(pts, fill=GOLD, width=width, joint='curve')


def gold_rails(draw):
    """The gold frame of the boosters: a rail down each side from under the logo, turning in at the foot
    into a bracket round the name, with a jewel at its centre."""
    top, turn, foot = 150, 700, 846
    for side in (1, -1):
        x = 34 if side == 1 else W - 35
        gold_line(draw, [(x, top), (x, turn)])
        draw.line([(x - side, top), (x - side, turn)], fill=GOLD_HI, width=1)
        draw.polygon([(x - 6, top), (x, top - 12), (x + 6, top), (x, top + 16)], fill=GOLD, outline=GOLD_EDGE)
        # at the foot: a step in, down beside the name, then under it to the middle
        k = 14 * side
        gold_line(draw, [(x, turn), (x + k, turn + 14), (x + k, foot - 18), (x + 2 * k, foot - 4), (W // 2 - 22 * side, foot - 4)], 2)
        gold_line(draw, [(x + k + 7 * side, turn + 30), (x + k + 7 * side, foot - 30)], 1)
    # the jewel under the name
    cx, cy = W // 2, 842
    draw.polygon([(cx - 16, cy), (cx, cy - 9), (cx + 16, cy), (cx, cy + 9)], fill=GOLD, outline=GOLD_EDGE)
    draw.polygon([(cx - 7, cy), (cx, cy - 4), (cx + 7, cy), (cx, cy + 4)], fill=GOLD_HI)


def glitter(img, c1, rng):
    """The foil's fine glitter, brighter where the light falls."""
    n = rng.random((H, W))
    spark = (n > .9982).astype(np.float32)
    spark = cv2.GaussianBlur(spark, (0, 0), .6) * 3
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    light = .4 + .6 * np.exp(-(((xx * .8 + yy * .35) - W * .55) / 160) ** 2)
    col = c1 * .35 + 255 * .65
    a = np.clip(spark * light * .8, 0, .75)[..., None]
    return img * (1 - a) + col * a


def gold_text(img, text, cy, face, max_w, size):
    """A line in gold with a dark edge and a shadow, as the set names are."""
    while True:
        f = ImageFont.truetype(face, size)
        box = f.getbbox(text)
        if box[2] - box[0] <= max_w or size <= 30:
            break
        size -= 2
    w, h = box[2] - box[0], box[3] - box[1]
    x = (W - w) // 2 - box[0]
    y = cy - h // 2 - box[1]
    mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(mask).text((x, y), text, font=f, fill=255)
    edge = Image.new('L', (W, H), 0)
    ImageDraw.Draw(edge).text((x, y), text, font=f, fill=255, stroke_width=4, stroke_fill=255)
    shadow = edge.filter(ImageFilter.GaussianBlur(6))
    t = np.clip((np.arange(H)[:, None] - (cy - h / 2)) / max(h, 1), 0, 1)
    top, midc, bot = np.array([200, 244, 255.]), np.array([90, 194, 240.]), np.array([30, 112, 176.])  # BGR
    grad = np.where((t < .5)[..., None], top + (midc - top) * (t / .5)[..., None], midc + (bot - midc) * ((t - .5) / .5)[..., None])
    grad = np.broadcast_to(grad, (H, W, 3))
    m = np.asarray(mask, float)[..., None] / 255
    e = np.asarray(edge, float)[..., None] / 255
    s = np.asarray(shadow, float)[..., None] / 255
    img[..., :3] = img[..., :3] * (1 - .6 * s) + np.array([8, 10, 24.]) * .6 * s
    img[..., :3] = img[..., :3] * (1 - e) + np.array([10, 22, 48.]) * e
    img[..., :3] = img[..., :3] * (1 - m) + grad * m
    return img


def plain_text(img, text, cy, face, size, spacing, x=None):
    f = ImageFont.truetype(face, size)
    widths = [f.getbbox(ch)[2] for ch in text]
    total = sum(widths) + spacing * (len(text) - 1)
    layer = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(layer)
    x = (W - total) / 2 if x is None else x
    for ch, w in zip(text, widths):
        d.text((x, cy - size * .62), ch, font=f, fill=255)
        x += w + spacing
    m = np.asarray(layer, float)[..., None] / 255
    sh = np.asarray(layer.filter(ImageFilter.GaussianBlur(2.5)), float)[..., None] / 255
    img[..., :3] = img[..., :3] * (1 - .5 * sh) + np.array([10, 10, 20.]) * .5 * sh
    img[..., :3] = img[..., :3] * (1 - m) + 250 * m
    return img


def main():
    title_face = font('faustina', 'faustina-latin-wght-normal.woff2', 800)
    ui_face = font('dm-sans', 'dm-sans-latin-wght-normal.woff2', 800)
    ven_rgba = cv2.imread(os.path.join(MEDIA, 'pack-ven.webp'), cv2.IMREAD_UNCHANGED)
    ven = ven_rgba[..., :3]
    outline = ven_rgba[..., 3].astype(float)
    logo_fg, logo_a = logo()
    manifest = json.load(open(MANIFEST))
    for pid, p in PACKS.items():
        rng = np.random.default_rng(sum(map(ord, pid)))
        c1, c2, c3 = (hex_bgr(c) for c in p['colors'])
        img = background(c1, c2, c3, rng)
        a, m, (ax, ay) = art(p['card'], p['crop'])
        win = img[ay:ay + a.shape[0], ax:ax + a.shape[1]]
        img[ay:ay + a.shape[0], ax:ax + a.shape[1]] = win * (1 - m[..., None]) + a * m[..., None]
        # the foot darkens into the wrapper's deepest colour, so the gold name reads on the art
        yy = np.linspace(0, 1, H)[:, None, None]
        foot = np.clip((yy - .66) / .2, 0, 1) ** 1.2 * .72
        img = img * (1 - foot) + c3 * foot
        img = glitter(img, c1, rng)
        img = crimps(img, ven)
        # the logo, centred, with a soft shadow under it as printed
        lh, lw = logo_a.shape
        x0, y0 = (W - lw) // 2, LOGO_TOP
        la = logo_a[..., None]
        sh = cv2.GaussianBlur(logo_a, (0, 0), 5)[..., None] * .45
        img[y0 + 3:y0 + 3 + lh, x0:x0 + lw] *= 1 - sh
        img[y0:y0 + lh, x0:x0 + lw] = img[y0:y0 + lh, x0:x0 + lw] * (1 - la) + logo_fg * la
        # gold frame and the words
        rgba = np.dstack([img, np.full((H, W), 255.)])
        frame = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        gold_rails(ImageDraw.Draw(frame))
        fr = np.asarray(frame, float)
        fa = fr[..., 3:4] / 255
        rgba[..., :3] = rgba[..., :3] * (1 - fa) + fr[..., [2, 1, 0]] * fa
        rgba = gold_text(rgba, p['title'], 762, title_face, W - 120, 72)
        rgba = plain_text(rgba, p['sub'], 812, ui_face, 19, 1.5)
        rgba = plain_text(rgba, '14+', LOGO_TOP + logo_a.shape[0] + 14, ui_face, 17, 1, x=(W + logo_a.shape[1]) // 2 - 34)
        # a soft sheen across the foil, as the photographed packs have
        yy, xx = np.mgrid[0:H, 0:W].astype(float)
        sheen = np.exp(-(((xx * .8 + yy * .35) - W * .55) / 90) ** 2) * .10
        rgba[..., :3] = np.clip(rgba[..., :3] + 255 * sheen[..., None], 0, 255)
        rgba[..., 3] = outline
        out = cv2.cvtColor(np.clip(rgba, 0, 255).astype(np.uint8), cv2.COLOR_BGRA2RGBA)
        name = f'pack-{pid}.webp'
        Image.fromarray(out).save(os.path.join(MEDIA, name), 'WEBP', quality=86, method=6)
        manifest['packs'][pid] = {'file': name, 'tear': TEAR, 'aspect': round(W / H, 4)}
        print(f'  {name}')
    json.dump(manifest, open(MANIFEST, 'w'), indent=2)
    open(MANIFEST, 'a').write('\n')


if __name__ == '__main__':
    main()
