#!/usr/bin/env python3
"""Downloads and crops the product imagery the app ships in public/media/.

    python3 scripts/prepare-media.py          (needs Pillow: pip install pillow)

Reads scripts/media.json:

    {
      "packs": {
        "<set id>": {"url": "...", "crop": [x, y, w, h] | null, "tear": 0.12,
                     "page": "<where Riot shows it>"}
      },
      "cardBack": {"url": "...", "crop": [x, y, w, h] | null, "page": "..."}
    }

Crop boxes are in pixels of the full-size source. Writes public/media/
pack-<set>.webp and card-back.webp, plus src/data/media.json, which
src/data/media.ts reads (file names, tear lines, aspect ratios).

All images are Riot Games' official product shots, used under Riot's fan
content policy; they are not covered by this project's licence.
"""
import io
import json
import os
import sys
import urllib.request

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC = os.path.join(ROOT, 'scripts', 'media.json')
OUT = os.path.join(ROOT, 'public', 'media')
MANIFEST = os.path.join(ROOT, 'src', 'data', 'media.json')

PACK_HEIGHT = 900      # px; packs show at most ~560 CSS px tall
BACK_WIDTH = 744       # same as the card scans
CARD_ASPECT = 744 / 1039


def fetch(url):
    # The image CDN converts on request; ask for a lossless PNG so the crop
    # is taken from clean pixels and alpha survives.
    sep = '&' if '?' in url else '?'
    full = url if 'fm=' in url else f'{url}{sep}fm=png'
    req = urllib.request.Request(full, headers={'User-Agent': 'riftbound-simulator/prepare-media'})
    with urllib.request.urlopen(req, timeout=120) as res:
        return Image.open(io.BytesIO(res.read())).convert('RGBA')


def crop(img, box):
    if not box:
        return img
    x, y, w, h = box
    return img.crop((x, y, x + w, y + h))


def round_corners(img, radius_frac=0.047):
    r = round(img.width * radius_frac)
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.width - 1, img.height - 1), r, fill=255)
    alpha = Image.composite(img.getchannel('A'), Image.new('L', img.size, 0), mask)
    img.putalpha(alpha)
    return img


def save(img, name):
    path = os.path.join(OUT, name)
    img.save(path, 'WEBP', quality=86, method=6)
    print(f'  {name}: {img.width}x{img.height}, {os.path.getsize(path) // 1024} KB')


def main():
    spec = json.load(open(SPEC))
    os.makedirs(OUT, exist_ok=True)
    manifest = {'packs': {}, 'cardBack': None}

    for set_id, p in spec.get('packs', {}).items():
        img = crop(fetch(p['url']), p.get('crop'))
        if img.height > PACK_HEIGHT:
            img = img.resize((round(img.width * PACK_HEIGHT / img.height), PACK_HEIGHT), Image.LANCZOS)
        name = f'pack-{set_id}.webp'
        save(img, name)
        manifest['packs'][set_id] = {
            'file': name,
            'tear': p.get('tear', 0.12),
            'aspect': round(img.width / img.height, 4),
        }

    back = spec.get('cardBack')
    if back:
        img = crop(fetch(back['url']), back.get('crop'))
        # Exactly card-shaped, so it lines up with the fronts when it flips.
        h = round(BACK_WIDTH / CARD_ASPECT)
        img = round_corners(img.resize((BACK_WIDTH, h), Image.LANCZOS))
        save(img, 'card-back.webp')
        manifest['cardBack'] = 'card-back.webp'

    with open(MANIFEST, 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')
    print(f'wrote {os.path.relpath(MANIFEST, ROOT)}')


if __name__ == '__main__':
    sys.exit(main())
