/*
 * Pictures from other hosts go through this site (server/http.ts, and the
 * dev server's proxy): the browser never asks Riot, the card databases or
 * Discord itself, so no visitor's address reaches them (GDPR) and the
 * WebGL foil can read the pixels. The preview build ships its own pictures
 * and leaves URLs as they are.
 */

// always, except in the self-contained preview (which ships its own pictures)
const OWN = !import.meta.env.VITE_PREVIEW;

const MAP: [RegExp, string][] = [
  [/^https:\/\/cmsassets\.rgpub\.io/, '/riot-img'],
  [/^https:\/\/assetcdn\.rgpub\.io/, '/riot-asset'],
  [/^https:\/\/static\.dotgg\.gg/, '/ext-img/dotgg'],
  [/^https:\/\/cdn\.piltoverarchive\.com/, '/ext-img/piltover'],
];

/** The URL as this site serves it; unchanged when it is already ours (or in the preview). */
export function ownUrl(url: string): string {
  if (!OWN) return url;
  for (const [re, to] of MAP) if (re.test(url)) return url.replace(re, to);
  return url;
}
