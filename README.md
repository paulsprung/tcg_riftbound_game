# Riftbound Simulator

A fan-made simulator for learning and playing Riot Games' **Riftbound** TCG:
open booster packs, collect every card, inspect them in 3D with foil effects
that react to your mouse or your phone's tilt, and (next) build decks and
play.

```bash
npm install
npm run dev            # http://localhost:5173
```

## What's in it

| | |
|---|---|
| **Open packs** | Every booster set, Origins to Radiance. Packs follow each set's real slot layout. Swipe or tap to tear, then flip the cards one at a time; new cards are marked, and the summary leads with the best pulls. A pack left mid-reveal can be continued. |
| **Collection** | Everything you pull, per set, with completion, copy and foil counts. Saved in your browser (localStorage). |
| **Showcase** | A display case for your best cards, and grading: a card comes back with subgrades and a grade from 1 to 10, sealed in a slab (a fictional grader, not PSA). |
| **Card database** | All 1,793 English printings, including the T1 Worlds Champion Collection and promos, with search and filters for set, rarity, type, domain and printing. |
| **Inspect** | Click any card: a 3D card with thickness, a moving shadow, foil and glare, gyroscope tilt on phones, and a tap to flip it over. |
| **Rules** | Links to Riot's official Rules Hub. The interactive guide comes with the play table. |

## Card data

`public/data/cards.json` is a snapshot built by:

```bash
npm run fetch-cards               # behind a proxy: NODE_USE_ENV_PROXY=1 npm run fetch-cards
npm run fetch-cards -- --raw      # re-normalise data/raw/ without the network
```

It merges these sources (see `src/data/normalize.ts` and `src/data/dotgg.ts`):

- **Riot's official card gallery** (`content.publishing.riotgames.com`) is the
  primary source: every retail set, including a new set's preview cards before
  release (that is how Radiance is in here early).
- **[Riftcodex](https://riftcodex.com)**, a free community API, adds the
  promo sets, flavour text, supertypes and explicit alt-art, overnumbered and
  signature flags.
- **[riftbound.gg](https://riftbound.gg)**'s card API repairs what the two
  lose: supertypes (Champion, Signature), tags, Radiance's types and domains
  (the gallery's are wrong on many cards, checked against the printed cards),
  Equipment might, cut-off promo texts, and Riot's errata, which the inspector
  shows as the current wording. It also gives clean scans of banned cards,
  whose gallery images carry a "BANNED" stamp. It never adds printings.
- **`data/supplement-cards.json`**: English printings none of the APIs list
  (the T1 collection, Organized Play and other promos, Spiritforged and
  Unleashed runes, Radiance signatures, double-sided tokens), curated from
  Riot's articles, TCGplayer, riftbound.gg and Piltover Archive. Each one's
  sources are in `data/supplement-sources.json`. Chinese and Korean printings
  are left out on purpose.
- **`data/image-overrides.json`**: printings whose source shows another
  printing's art, with the right image.

Card art is never copied into the repo. The app loads it from Riot's image
server, which resizes on request, so grids load small thumbnails; the few
cards that come from elsewhere use riftbound.gg's or TCGplayer's images.

Re-run `fetch-cards` when a set's previews update or a new set arrives. Then
add the set to `BOOSTER_SETS` in `src/pack/packConfig.ts` (wrapper colours,
cover champion, slot layout).

## Packaging, card backs and type

- **Booster packs** are Riot's official product renders, one per set, cut
  out from the Riot Games Store and playriftbound.com images. The pack tears
  along its real crimp line.
- **Card backs** are the real ones: the navy main-deck back and the white
  rune-deck back, from the vector artwork in Riot's How to Play PDF. Rune
  cards flip over from the white back.
- Both live in `public/media/`. Where each image comes from, how it was
  cropped and what was retouched is in `scripts/media-sources.json`, and
  `python3 scripts/prepare-media.py <dir>` re-encodes the cut-outs.
- **Type.** Riftbound's own faces are commercial and licensed to Riot:
  Beaufort for LOL and TT Norms Pro Compact on Riot's site, and Arpona and
  Lorimer No 2 on the printed cards. They are not copied or hotlinked. The
  app uses the closest free Google Fonts, picked by side-by-side renders
  against the real text:

  | Riftbound | Here | Used for |
  |---|---|---|
  | Beaufort for LOL | Faustina 800 | Headings and set names, in capitals |
  | TT Norms Pro Compact | DM Sans | Interface and body text |
  | Arpona Bold | Proza Libre 800 | Card names and numbers |
  | Lorimer No 2 | Instrument Sans, 75% width | Rules text, keyword chips, type lines |

## Pack contents and odds

Slot layouts come from Riot's set overview articles:

- **Origins, Spiritforged, Unleashed, Vendetta:** 7 Common, 3 Uncommon,
  1 Foil, 2 Rare-or-better (Rare, Epic, Alt Art, Overnumbered, Signature or
  Ultimate), 1 Rune/Token/Alt Rune.
- **Radiance:** 7 Common, 3 Uncommon, 1 Foil, 1 Rare/Epic, 1 Showcase slot
  (Rare, Epic, Alt Art, Overnumbered, Signature or Ultimate), 1 Rune/Token/Alt
  Rune.

**Riot publishes only some of the odds:** Epic about 1 in 4 packs, alt art
about 2 per box, overnumbered about 1 per 3 boxes with 1 in 10 signed (all
for Origins), and the Ultimate rares (Unleashed's Baron Nashor under 0.1% of
packs, Radiance's Packed Amphitheater about 0.025%, never two in a pack).
The rest, such as alt-art runes and Legends per box, are estimates from
community box openings. Each value is documented next to it in
`packConfig.ts`; `tests/generate.test.ts` checks the rates and
`tests/data.test.ts` checks that every set deals full packs from the real
card pools.

## Foil effects

The foil layers are built from Riot's descriptions and from photos of real
cards:

| Printing | Finish |
|---|---|
| Common / Uncommon | Plain card stock, soft gloss |
| Foil-slot card | Smooth prismatic sheen over the whole face |
| Rare / Epic (always foil) | The same, stronger; epics add glitter |
| Alt art / Overnumbered | Rainbow holo plus **etched lines that trace the card's own linework**: an SVG edge filter run over the art, lit in a band that sweeps across as you tilt |
| Signature | Etched holo with gold glints |
| Ultimate (Radiance's *Packed Amphitheater*) | Everything, plus a cracked-ice field |

The header's **Foil** switch toggles between *Subtle*, the warmer English
printing, and *Vivid*, the stronger rainbow of the Chinese printing.

The tilt engine (`src/card/tilt.ts`) comes from the birthday-card project:
spring physics, gyroscope with iOS permission handling, and an animation loop
that sleeps when nothing moves, so a grid of 1,500 cards costs nothing until
you touch one.

The card images are flat, so there is no true parallax depth (the character
popping out of the frame). That would need a per-card depth map rendered in
WebGL, which is listed below as a possible upgrade.

## Roadmap

1. ~~Card data, pack opening, foil effects, collection~~
2. Rules guide inside the app: turn structure, runes, battlefields, scoring,
   keyword glossary
3. Deck builder: Legend, Champion, 40-card main deck, 12 runes, 3 battlefields,
   with legality checks against the Core Rules
4. Manual play table: zones, drag-and-drop, score tracking, two players
5. Rules engine: phases, combat and keywords, then card abilities set by set
6. Computer opponent
7. Optional: depth-map parallax for the inspect view

## Scripts

| | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Typecheck and build to `dist/`, deployable to any static host (Cloudflare Pages, GitHub Pages) |
| `npm test` | Unit tests (normaliser, data repairs, pack generator, grading) |
| `npm run typecheck` | TypeScript only |
| `npm run fetch-cards` | Refresh the card snapshot |

---

Fan project, not affiliated with or endorsed by Riot Games. Riftbound, League
of Legends and all card art are © Riot Games.
