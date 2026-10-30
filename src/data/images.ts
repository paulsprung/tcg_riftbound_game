import { useEffect, useState } from 'react';
import { ownUrl } from './hosts.ts';
import type { Card } from './types.ts';

/*
 * Where a card's picture comes from.
 *
 * Normally that is Riot's image server, which resizes on request. The
 * self-contained preview build (npm run build:preview) cannot reach other
 * hosts, so it ships the art itself: each card's `image` is then a
 * reference like "bundle:ogn-03", naming a JSON file under images/ that
 * maps card ids to base64 WebP. A bundle is fetched the first time one of
 * its cards is shown and turned into blob: URLs once.
 */

const BUNDLE = 'bundle:';

/** The image server resizes on request; grids don't need the full 744px scan. */
export function imageAt(card: Card, width: number): string {
  if (!card.image || card.image.startsWith(BUNDLE)) return '';
  if (!/rgpub\.io/.test(card.image)) return ownUrl(card.image);
  // same-origin through this site (data/hosts.ts), so the WebGL foil can read the pixels
  return ownUrl(`${card.image}${card.image.includes('?') ? '&' : '?'}w=${width}`);
}

/** Can a WebGL texture be made from this URL? Cross-origin images without
    CORS headers would taint the canvas. */
export function isReadable(src: string): boolean {
  if (!src) return false;
  if (src.startsWith('blob:') || src.startsWith('data:')) return true;
  try {
    const origin = new URL(src, location.href).origin;
    return origin === location.origin || CORS_HOSTS.includes(origin);
  } catch { return false; }
}

/** Image hosts that send Access-Control-Allow-Origin: * */
const CORS_HOSTS = ['https://static.dotgg.gg', 'https://cdn.piltoverarchive.com', 'https://tcgplayer-cdn.tcgplayer.com'];

type Urls = Record<string, string>;
const bundles = new Map<string, Promise<Urls>>();
const ready = new Map<string, Urls>();

function toBlobUrl(base64: string): string {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }));
}

function loadBundle(name: string): Promise<Urls> {
  let p = bundles.get(name);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}images/${name}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<Record<string, string>>;
      })
      .then((data) => {
        const urls: Urls = {};
        for (const [id, b64] of Object.entries(data)) urls[id] = toBlobUrl(b64);
        ready.set(name, urls);
        return urls;
      })
      .catch((err) => {
        bundles.delete(name);   // let a later render try again
        throw err;
      });
    bundles.set(name, p);
  }
  return p;
}

const bundleOf = (card: Card) => (card.image.startsWith(BUNDLE) ? card.image.slice(BUNDLE.length) : null);

const decoded = new Map<string, Promise<boolean>>();

/** Resolves true once the card's art at about `width` px is downloaded and
    decoded, false if it can't be had (tried again on the next call). */
export function cardImageReady(card: Card, width: number): Promise<boolean> {
  const key = `${card.id}@${width}`;
  let p = decoded.get(key);
  if (!p) {
    const bundle = bundleOf(card);
    const src = bundle ? loadBundle(bundle).then((urls) => urls[card.id] ?? '') : Promise.resolve(imageAt(card, width));
    p = src.then((s) => {
      if (!s) return false;
      const img = new Image();
      img.decoding = 'async';
      img.src = s;
      return img.decode().then(() => true, () => false);
    }, () => false);
    decoded.set(key, p);
    p.then((ok) => { if (!ok) decoded.delete(key); });
  }
  return p;
}

const RETRIES = 4;

/** The card's image URL at roughly `width` px; '' while it loads or if it fails. */
export function useCardImage(card: Card, width: number): { src: string; failed: boolean } {
  const bundle = bundleOf(card);
  const direct = bundle ? null : imageAt(card, width);
  const peek = () => (bundle ? ready.get(bundle)?.[card.id] ?? '' : direct ?? '');
  const [state, setState] = useState(() => ({ key: card.id, src: peek(), failed: false }));
  const [tries, setTries] = useState(0);

  useEffect(() => { setTries(0); }, [bundle, card.id]);

  useEffect(() => {
    if (!bundle) return;
    if (ready.get(bundle)?.[card.id]) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    loadBundle(bundle)
      .then((urls) => alive && setState({ key: card.id, src: urls[card.id] ?? '', failed: !urls[card.id] }))
      .catch(() => {
        if (!alive) return;
        setState({ key: card.id, src: '', failed: true });
        // A dropped connection should not leave the card blank for good.
        if (tries < RETRIES) timer = setTimeout(() => setTries((t) => t + 1), 1500 * 2 ** tries);
      });
    return () => { alive = false; clearTimeout(timer); };
  }, [bundle, card.id, tries]);

  // A different card (or width) than the one in state: answer from cache.
  if (state.key !== card.id || (!bundle && state.src !== direct)) return { src: peek(), failed: false };
  // Another view may have loaded the bundle since this one failed.
  const cached = peek();
  return { src: state.src || cached, failed: state.failed && !cached };
}
