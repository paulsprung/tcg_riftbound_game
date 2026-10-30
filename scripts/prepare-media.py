#!/usr/bin/env python3
"""Encodes the product imagery the app ships in public/media/.

    python3 scripts/prepare-media.py <dir>      (needs Pillow: pip install pillow)
    python3 scripts/prepare-media.py --products <dir>

<dir> holds the cleaned-up PNG cut-outs: pack-<set>.png, card-back.png and
optionally card-back-rune.png. Where each one comes from, how it was cropped
and what was retouched is recorded in scripts/media-sources.json; the packs
that stand in front of a display box in Riot's renders needed their
overlapping edge rebuilt by hand, so the cut-outs are the source of truth
rather than something this script can recreate from the URLs.

Writes public/media/*.webp plus src/data/media.json, which
src/data/media.ts reads (file names, tear lines, aspect ratios).

With --products, <dir> holds product-<id>.png: the shop's product shots
(booster displays, decks, bundles), cut from the renders listed under
"products" in media-sources.json. Only those are encoded, into
public/media/products/, and only their part of media.json changes.

All images are Riot Games' official product renders and print artwork,
used under Riot's fan content policy; they are not covered by this
project's licence.
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = os.path.join(ROOT, 'scripts', 'media-sources.json')
OUT = os.path.join(ROOT, 'public', 'media')
MANIFEST = os.path.join(ROOT, 'src', 'data', 'media.json')

PACK_HEIGHT = 900      # px; a pack shows at most ~560 CSS px tall
PRODUCT_SIZE = 720     # px, the longer side; a product shows at most ~360 CSS px
BACK_SIZE = (744, 1039)  # same as the card scans


def save(img, name):
    path = os.path.join(OUT, name)
    img.save(path, 'WEBP', quality=86, method=6)
    print(f'  {name}: {img.width}x{img.height}, {os.path.getsize(path) // 1024} KB')


def main(src_dir):
    sources = json.load(open(SOURCES))
    os.makedirs(OUT, exist_ok=True)
    old = json.load(open(MANIFEST)) if os.path.exists(MANIFEST) else {}
    manifest = {'packs': {}, 'cardBack': None, 'cardBackRune': None, 'products': old.get('products', {})}

    for set_id, meta in sources['packs'].items():
        path = os.path.join(src_dir, f'pack-{set_id}.png')
        if not os.path.exists(path):
            print(f'  (no {os.path.basename(path)}; {set_id} keeps the drawn wrapper)')
            continue
        img = Image.open(path).convert('RGBA')
        if img.height > PACK_HEIGHT:
            img = img.resize((round(img.width * PACK_HEIGHT / img.height), PACK_HEIGHT), Image.LANCZOS)
        name = f'pack-{set_id}.webp'
        save(img, name)
        manifest['packs'][set_id] = {'file': name, 'tear': meta['tear'], 'aspect': round(img.width / img.height, 4)}

    for key, file in (('cardBack', 'card-back'), ('cardBackRune', 'card-back-rune')):
        path = os.path.join(src_dir, f'{file}.png')
        if os.path.exists(path):
            save(Image.open(path).convert('RGBA').resize(BACK_SIZE, Image.LANCZOS), f'{file}.webp')
            manifest[key] = f'{file}.webp'

    with open(MANIFEST, 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')
    print(f'wrote {os.path.relpath(MANIFEST, ROOT)}')


def products(src_dir):
    sources = json.load(open(SOURCES))
    manifest = json.load(open(MANIFEST))
    out = os.path.join(OUT, 'products')
    os.makedirs(out, exist_ok=True)
    manifest['products'] = {}
    for pid in sources['products']:
        path = os.path.join(src_dir, f'product-{pid}.png')
        if not os.path.exists(path):
            print(f'  (no {os.path.basename(path)})')
            continue
        img = Image.open(path).convert('RGBA')
        img.thumbnail((PRODUCT_SIZE, PRODUCT_SIZE), Image.LANCZOS)
        name = f'products/{pid}.webp'
        save(img, name)
        manifest['products'][pid] = {'file': name, 'aspect': round(img.width / img.height, 4)}
    with open(MANIFEST, 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')
    print(f'wrote {os.path.relpath(MANIFEST, ROOT)}')


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--products':
        products(sys.argv[2])
    elif len(sys.argv) == 2:
        main(sys.argv[1])
    else:
        sys.exit(__doc__)
