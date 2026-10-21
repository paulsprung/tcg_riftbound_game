/*
 * Format legality [103.3.e], TR 601: which sets a format allows and which
 * cards it bans. Data, not code, so a new ban list is a data change.
 *
 * Ban lists as Riot's Rules Hub gives them ("Constructed Format Legality"
 * and "2v2 Constructed Legality", both last updated September 18, 2026),
 * checked against the three ban articles. Bans go by name, so every
 * printing of a banned card is banned. There is no restricted list.
 *
 *   2026-03-31  Called Shot; Draven, Vanquisher; Fight or Flight; Scrapheap;
 *               Dreaming Tree, Obelisk of Power, Reaver's Row
 *   2026-07-24  Stealthy Pursuer; The Arena's Greatest, Aspirant's Climb;
 *               the 2v2 list starts: Standard plus Master Yi, Wuju Bladesman
 *   2026-09-18  Ekko, Recurrent; Stacked Deck (both formats)
 *
 * Exceptions the validator applies (decks/validate.ts): at low OPL an
 * unmodified preconstructed deck may keep its banned cards (TR 601.2.d.2);
 * Limited formats ignore Constructed bans (TR 602.1.b) and are out of scope.
 */
import type { DefId } from '../state/types.ts';

export type Format = 'standard' | '2v2';

export interface Ban {
  def: DefId;
  /** The name as the ban list prints it. */
  listed: string;
  kind: 'card' | 'battlefield' | 'legend';
  since: string;
  source: string;
}

export interface FormatInfo {
  id: Format;
  name: string;
  /** Set ids whose cards, and every card sharing a name with one, are legal
      (TR 601.2.a). Promo sets are legal only through such a name. */
  sets: string[];
  bans: Ban[];
  updated: string;
  source: string;
}

const HUB = 'https://playriftbound.com/en-us/rules-hub/';
const MARCH = 'https://playriftbound.com/en-us/news/announcements/announcing-riftbounds-first-bans/';
const JULY = 'https://playriftbound.com/en-us/news/announcements/july-ban-list-updates/';
const SEPTEMBER = 'https://playriftbound.com/en-us/news/announcements/'
  + 'september-ban-list-updates-effective-september-18-2026/';

/** Standard (TR 601.3.c): OGS, OGN, SFD, UNL, VEN, RAD. */
export const STANDARD_SETS = ['ogs', 'ogn', 'sfd', 'unl', 'ven', 'rad'];

/** Release dates of sets that are not out everywhere yet. Legality follows
    the launch date (TR 601.2.b); Radiance launches October 23rd, 2026
    (TR 601.3.c.6.a). Sets not listed are released. */
export const SET_RELEASES: Record<string, string> = { rad: '2026-10-23' };

/** Whether a set is out on a date (ISO 'yyyy-mm-dd'). */
export function isReleased(set: string, asOf: string): boolean {
  const day = SET_RELEASES[set];
  return day === undefined || asOf >= day;
}

const STANDARD_BANS: Ban[] = [
  { def: 'called-shot', listed: 'Called Shot', kind: 'card', since: '2026-03-31', source: MARCH },
  { def: 'draven-vanquisher', listed: 'Draven, Vanquisher', kind: 'card', since: '2026-03-31', source: MARCH },
  { def: 'fight-or-flight', listed: 'Fight or Flight', kind: 'card', since: '2026-03-31', source: MARCH },
  { def: 'scrapheap', listed: 'Scrapheap', kind: 'card', since: '2026-03-31', source: MARCH },
  { def: 'stealthy-pursuer', listed: 'Stealthy Pursuer', kind: 'card', since: '2026-07-24', source: JULY },
  { def: 'ekko-recurrent', listed: 'Ekko, Recurrent', kind: 'card', since: '2026-09-18', source: SEPTEMBER },
  { def: 'stacked-deck', listed: 'Stacked Deck', kind: 'card', since: '2026-09-18', source: SEPTEMBER },
  // The list says "Dreaming Tree"; the card is named "The Dreaming Tree".
  { def: 'the-dreaming-tree', listed: 'Dreaming Tree', kind: 'battlefield', since: '2026-03-31', source: MARCH },
  { def: 'obelisk-of-power', listed: 'Obelisk of Power', kind: 'battlefield', since: '2026-03-31', source: MARCH },
  { def: 'reavers-row', listed: "Reaver's Row", kind: 'battlefield', since: '2026-03-31', source: MARCH },
  { def: 'the-arenas-greatest', listed: "The Arena's Greatest", kind: 'battlefield', since: '2026-07-24', source: JULY },
  { def: 'aspirants-climb', listed: "Aspirant's Climb", kind: 'battlefield', since: '2026-07-24', source: JULY },
];

export const FORMATS: Record<Format, FormatInfo> = {
  standard: {
    id: 'standard', name: 'Standard Constructed', sets: STANDARD_SETS, bans: STANDARD_BANS,
    updated: '2026-09-18', source: HUB,
  },
  // The July article: future updates say whether they apply to both lists,
  // so 2v2 is kept as Standard plus its own additions.
  '2v2': {
    id: '2v2', name: '2v2 Constructed', sets: STANDARD_SETS, updated: '2026-09-18', source: HUB,
    bans: [
      ...STANDARD_BANS,
      // The Origins: Proving Grounds legend (OGS-019), not Unleashed's "Wuju Master".
      { def: 'master-yi-wuju-bladesman', listed: 'Master Yi, Wuju Bladesman', kind: 'legend', since: '2026-07-24',
        source: JULY },
    ],
  },
};

/** The ban on a card in a format, if it is banned there. */
export function banOf(format: Format, def: DefId): Ban | undefined {
  return FORMATS[format].bans.find((b) => b.def === def);
}
