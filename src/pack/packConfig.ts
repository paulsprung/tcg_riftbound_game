/*
 * What goes into a booster pack, per set.
 *
 * Slot layouts, from Riot's set overviews on playriftbound.com:
 *
 *   Origins / Spiritforged / Unleashed / Vendetta (14 cards)
 *     7 Common, 3 Uncommon, 1 Foil (Common, Uncommon, Rare or Epic),
 *     2 Rare-or-better (Rare, Epic, Alt Art, Special Alt, Overnumbered,
 *     Ultimate), 1 Token / Rune / Alt Rune
 *   Radiance (14 cards)
 *     7 Common, 3 Uncommon, 1 Foil, 1 Rare or Epic, 1 showcase slot (Rare,
 *     Epic, Alt Art, Special Alt, Overnumbered or Ultimate),
 *     1 Token / Rune / Alt Art Rune
 *
 * Riot's published rates: Epic ~1 in 4 packs, Alt art ~2 per box,
 * Overnumbered ~1 per 3 boxes with 1 in 10 of them signed (all Origins);
 * Ultimate < 0.1% of packs (Unleashed), ~0.025% (Radiance), never two in
 * one pack. Special alt arts (Crystal Rose, K/DA) come as often as other
 * alt arts.
 * Community estimates (box openings), not published by Riot: alt-art runes
 * ~1 per box, foil runes rarer than that, Legends ~12 per box in Unleashed
 * and Vendetta, alt arts 2-3 per box in later sets.
 * Correct them here when better numbers turn up.
 *
 * The order of `slots` is the order the cards are revealed in, so the
 * exciting slots go last.
 */

/** A named slice of a set's card pool. See poolFor() in generate.ts. */
export type PoolKey =
  | 'common' | 'uncommon' | 'rare' | 'legend' | 'otherRare' | 'epic'
  | 'altArt' | 'overnumbered' | 'signature' | 'ultimate'
  | 'rune' | 'altRune' | 'token';

export interface Outcome {
  pool: PoolKey;
  weight: number;
  /** Overrides the slot's foil setting for this outcome. */
  foil?: boolean;
}

export interface SlotSpec {
  label: string;
  count: number;
  foil: boolean;
  /** Weighted outcomes; weights need not sum to 1. */
  table: Outcome[];
}

export interface PackConfig {
  cardsPerPack: number;
  packsPerBox: number;
  slots: SlotSpec[];
  /** Collector codes of the set's Ultimate rare(s), if it has any. */
  ultimate?: string[];
  /** Collector codes of the token printings found in boosters. Omit to use every base token of the set. */
  tokens?: string[];
}

export interface SetStyle {
  /** Pack wrapper colours, from photos of the real wrappers. */
  wrapper: [string, string, string];
  /** Champion on the real wrapper; their card art is used as key art. */
  hero?: string;
  tagline?: string;
}

const BOX = 24;
const perPack = (perBox: number) => perBox / BOX;

const common = (count: number): SlotSpec => ({ label: 'Common', count, foil: false, table: [{ pool: 'common', weight: 1 }] });
const uncommon = (count: number): SlotSpec => ({ label: 'Uncommon', count, foil: false, table: [{ pool: 'uncommon', weight: 1 }] });

const runeSlot: SlotSpec = {
  label: 'Rune',
  count: 1,
  foil: false,
  table: [
    { pool: 'rune', weight: 0.87 },
    { pool: 'rune', weight: 0.02, foil: true },      // "occasionally" (Origins); ~0.5 per box, estimate
    { pool: 'token', weight: 0.075 },                // no published rate
    { pool: 'altRune', weight: 0.035, foil: true },  // ~0.85 per box, community box openings
  ],
};

const foilSlot: SlotSpec = {
  label: 'Foil',
  count: 1,
  foil: true,
  table: [
    { pool: 'common', weight: 0.6 },
    { pool: 'uncommon', weight: 0.3 },
    { pool: 'rare', weight: 0.08 },
    { pool: 'epic', weight: 0.02 },
  ],
};

interface Rates {
  /** Epics per pack from the rare-or-better slots. */
  epicPerPack: number;
  altPerBox: number;
  /** Unsigned overnumbers per box; signatures come on top. */
  ovnPerBox: number;
  sigPerBox: number;
  ultPerPack?: number;
  /** Legends per box from the rare-or-better slots; omit to treat them like any rare. */
  legendPerBox?: number;
}

/** `count` identical rare-or-better slots that share the given rates. */
function rarePlus(count: number, r: Rates, label = 'Rare+'): SlotSpec {
  const perSlot = (perBox: number) => perPack(perBox) / count;
  const ult = (r.ultPerPack ?? 0) / count;
  const sig = perSlot(r.sigPerBox);
  const ovn = perSlot(r.ovnPerBox);
  const alt = perSlot(r.altPerBox);
  const epic = r.epicPerPack / count;
  const legend = r.legendPerBox ? perSlot(r.legendPerBox) : 0;
  const table: Outcome[] = [
    { pool: 'ultimate', weight: ult },
    { pool: 'signature', weight: sig },
    { pool: 'overnumbered', weight: ovn },
    { pool: 'altArt', weight: alt },
    { pool: 'epic', weight: epic },
  ];
  if (legend) table.push({ pool: 'legend', weight: legend });
  // With a Legend rate, the rest of the slot is the other rares.
  table.push({ pool: legend ? 'otherRare' : 'rare', weight: 1 - ult - sig - ovn - alt - epic - legend });
  return { label, count, foil: true, table };
}

/** Riot's Origins figures: Epic 1 in 4 packs, alt art ~2 per box, overnumber ~1 per 3 boxes, 1 in 10 signed. */
const ORIGINS_RATES: Rates = { epicPerPack: 0.25, altPerBox: 2, ovnPerBox: 0.3, sigPerBox: 1 / 30 };
const LATER_RATES: Rates = { ...ORIGINS_RATES, altPerBox: 2.5 };

const pack = (slots: SlotSpec[], extra: Partial<PackConfig> = {}): PackConfig =>
  ({ cardsPerPack: 14, packsPerBox: BOX, slots: [common(7), uncommon(3), runeSlot, foilSlot, ...slots], ...extra });

const ORIGINS = pack([rarePlus(2, ORIGINS_RATES)], {
  tokens: ['OGN-271/298', 'OGN-272/298', 'OGN-273/298', 'OGN-274/298'],
});

const SPIRITFORGED = pack([rarePlus(2, ORIGINS_RATES)], {
  tokens: ['SFD-T01', 'SFD-T02', 'SFD-T03'],
});

const UNLEASHED = pack([rarePlus(2, { ...LATER_RATES, ultPerPack: 0.0008, legendPerBox: 12 })], {
  ultimate: ['UNL-238/219'],
  // the faces of its double-sided token cards, each a card of its own (data/normalize.ts singleTokens)
  tokens: ['UNL-T01', 'UNL-T02', 'UNL-T03', 'UNL-T04', 'UNL-T05', 'UNL-T06', 'UNL-T07', 'UNL-T08'],
});

const VENDETTA = pack([rarePlus(2, { ...LATER_RATES, legendPerBox: 12 })], {
  // Tentacle (T06) has no picture anywhere: left out
  tokens: ['VEN-T01', 'VEN-T02', 'VEN-T03', 'VEN-T04', 'VEN-T05'],
});

const RADIANCE = pack([
  { label: 'Rare', count: 1, foil: true, table: [{ pool: 'epic', weight: 0.125 }, { pool: 'rare', weight: 0.875 }] },
  rarePlus(1, { ...LATER_RATES, epicPerPack: 0.125, ultPerPack: 0.00025 }, 'Showcase'),
], {
  ultimate: ['RAD-184/167'],
  // Provisional (dotgg only); re-check once TCGplayer lists the booster tokens.
  tokens: ['RAD-T01', 'RAD-T02', 'RAD-T03', 'RAD-T04', 'RAD-T05', 'RAD-T06', 'RAD-T07'],
});

/** Sets you can buy boosters of, newest first. */
export const BOOSTER_SETS: { id: string; pack: PackConfig; style: SetStyle }[] = [
  { id: 'rad', pack: RADIANCE, style: { wrapper: ['#f4f8ff', '#9fc9f2', '#3d5a8f'], hero: 'Seraphine', tagline: 'Set 5' } },
  { id: 'ven', pack: VENDETTA, style: { wrapper: ['#e0306b', '#7a1035', '#1b5e4a'], hero: 'Akali', tagline: 'Set 4' } },
  { id: 'unl', pack: UNLEASHED, style: { wrapper: ['#b56cff', '#5a2a9c', '#1d0f3d'], hero: 'Vi', tagline: 'Set 3' } },
  { id: 'sfd', pack: SPIRITFORGED, style: { wrapper: ['#fff6e6', '#f2b8c6', '#8a4f6b'], hero: 'Ahri', tagline: 'Set 2' } },
  { id: 'ogn', pack: ORIGINS, style: { wrapper: ['#4a6cf0', '#1f2a78', '#0b0f33'], hero: 'Jinx', tagline: 'Set 1' } },
];

export function boosterSet(setId: string) {
  return BOOSTER_SETS.find((s) => s.id === setId);
}
