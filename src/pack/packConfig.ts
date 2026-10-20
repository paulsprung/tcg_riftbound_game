/*
 * What goes into a booster pack, per set.
 *
 * Slot layouts follow Riot's set overview articles on playriftbound.com:
 *
 *   Origins / Spiritforged (14 cards)
 *     7 Common, 3 Uncommon, 1 Foil (any rarity), 2 Rare-or-better,
 *     1 Rune/Token (occasionally a foil rune, very rarely an alt-art rune)
 *   Unleashed / Vendetta / Radiance (14 cards)
 *     7 Common, 3 Uncommon, 1 Foil, 1 Rare/Epic,
 *     1 flex slot: Rare, Epic, Alt Art, Special Alt, Overnumbered or Ultimate,
 *     1 Rune/Token/Alt Rune
 *
 * Riot does not publish exact odds. The weights below are ESTIMATES pieced
 * together from Riot's wording and community box openings:
 *   Epic             ~1 per 4 packs (Origins)
 *   Alt art          ~2-3 per 24-pack box
 *   Overnumbered     ~1 per box
 *   Signature        ~1 per 30 boxes
 *   Ultimate (RAD)   ~0.025% of packs (Riot's figure)
 * Correct them here when better numbers turn up.
 *
 * The order of `slots` is the order the cards are revealed in, so the
 * exciting slots go last.
 */

/** A named slice of a set's card pool. See poolFor() in generate.ts. */
export type PoolKey =
  | 'common' | 'uncommon' | 'rare' | 'epic'
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
    { pool: 'rune', weight: 0.78 },
    { pool: 'rune', weight: 0.14, foil: true },
    { pool: 'token', weight: 0.075 },
    { pool: 'altRune', weight: 0.005, foil: true },
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

/** Origins-era rare slot; there are two of them per pack. */
function rarePlusSlot(): SlotSpec {
  const epic = 1 / 8;
  const alt = perPack(2) / 2;
  const ovn = perPack(1 / 3) / 2;
  const sig = perPack(1 / 30) / 2;
  return {
    label: 'Rare+',
    count: 2,
    foil: true,
    table: [
      { pool: 'epic', weight: epic },
      { pool: 'altArt', weight: alt },
      { pool: 'overnumbered', weight: ovn },
      { pool: 'signature', weight: sig },
      { pool: 'rare', weight: 1 - epic - alt - ovn - sig },
    ],
  };
}

const ORIGINS_ERA: PackConfig = {
  cardsPerPack: 14,
  packsPerBox: BOX,
  slots: [common(7), uncommon(3), runeSlot, foilSlot, rarePlusSlot()],
};

function laterEra(ultimate?: string[]): PackConfig {
  const alt = perPack(2.5);
  const ovn = perPack(1);
  const sig = perPack(1 / 30);
  const ult = ultimate ? 0.00025 : 0;
  const epic = 0.2;
  return {
    cardsPerPack: 14,
    packsPerBox: BOX,
    ultimate,
    slots: [
      common(7),
      uncommon(3),
      runeSlot,
      foilSlot,
      { label: 'Rare', count: 1, foil: true, table: [{ pool: 'epic', weight: 1 / 6 }, { pool: 'rare', weight: 5 / 6 }] },
      {
        label: 'Showcase',
        count: 1,
        foil: true,
        table: [
          { pool: 'ultimate', weight: ult },
          { pool: 'signature', weight: sig },
          { pool: 'overnumbered', weight: ovn },
          { pool: 'altArt', weight: alt },
          { pool: 'epic', weight: epic },
          { pool: 'rare', weight: 1 - ult - sig - ovn - alt - epic },
        ],
      },
    ],
  };
}

/** Sets you can buy boosters of, newest first. */
export const BOOSTER_SETS: { id: string; pack: PackConfig; style: SetStyle }[] = [
  { id: 'rad', pack: laterEra(['RAD-184/167']), style: { wrapper: ['#f4f8ff', '#9fc9f2', '#3d5a8f'], hero: 'Seraphine', tagline: 'Set 5' } },
  { id: 'ven', pack: laterEra(), style: { wrapper: ['#e0306b', '#7a1035', '#1b5e4a'], hero: 'Akali', tagline: 'Set 4' } },
  { id: 'unl', pack: laterEra(), style: { wrapper: ['#b56cff', '#5a2a9c', '#1d0f3d'], hero: 'Vi', tagline: 'Set 3' } },
  { id: 'sfd', pack: ORIGINS_ERA, style: { wrapper: ['#fff6e6', '#f2b8c6', '#8a4f6b'], hero: 'Ahri', tagline: 'Set 2' } },
  { id: 'ogn', pack: ORIGINS_ERA, style: { wrapper: ['#4a6cf0', '#1f2a78', '#0b0f33'], hero: 'Jinx', tagline: 'Set 1' } },
];

export function boosterSet(setId: string) {
  return BOOSTER_SETS.find((s) => s.id === setId);
}
