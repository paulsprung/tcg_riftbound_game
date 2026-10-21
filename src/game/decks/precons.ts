/*
 * The two official Radiance Showdown Decks (§13.1), Seraphine and Evelynn,
 * made to be played against each other: the built-in decks until the deck
 * builder exists. The lists are the ones the Radiance overview article
 * publishes, card for card; a test checks that every card resolves in the
 * oracle and that both decks validate.
 *
 * Legality: Radiance launches on October 23rd, 2026 (TR 601.3.c.6.a), and
 * a Radiance card is legal for sanctioned play only from its launch in the
 * event's region (TR 601.2.b). Before that date the decks validate for
 * casual play; validateDeck with `asOf` reports the launch date.
 *
 * "Champion Options" counts are main-deck copies: the player designates one
 * of them as the Chosen Champion and the others stay in the deck, so the 40
 * include them [103.3.a], TR 402.1. The default Chosen Champion is the
 * cheapest option. Heimerdinger, Academy Instructor and K'Sante, Courageous
 * are champion units of other champions: ordinary main-deck cards here
 * [103.3.c], never Chosen Champion candidates [103.3.a.2].
 */
import type { DeckList } from './decklist.ts';

export interface Precon {
  id: 'seraphine' | 'evelynn';
  product: string;
  set: 'rad';
  /** Launch date: legal for sanctioned play from this day (TR 601.2.b). */
  releases: string;
  source: string;
  /** The physical tokens in the box, as the list prints them. Not part of
      the deck [185]; the game makes tokens from [187]. */
  tokens: string[];
  deck: DeckList;
}

const SOURCE = 'https://playriftbound.com/en-us/news/announcements/the-radiance-overview/';

export const SERAPHINE_PRECON: DeckList = {
  name: 'Seraphine Showdown Deck',
  source: 'precon',
  legend: 'seraphine-starry-eyed-songstress',
  championOptions: ['seraphine-not-alone', 'seraphine-inspiring'],
  chosenChampion: 'seraphine-inspiring',
  main: [
    // Champion Options
    { def: 'seraphine-not-alone', n: 1 },
    { def: 'seraphine-inspiring', n: 2 },
    // Main Deck
    { def: 'encore', n: 1 },
    { def: 'heimerdinger-academy-instructor', n: 1 },
    { def: 'raucous-anthem', n: 2 },
    { def: 'piltovan-guidebot', n: 2 },
    { def: 'dune-devourer', n: 1 },
    { def: 'the-empyrean', n: 1 },
    { def: 'steadfast-outrider', n: 2 },
    { def: 'rousing-display', n: 2 },
    { def: 'supernova', n: 2 },
    { def: 'burn-away', n: 1 },
    { def: 'concert-poster', n: 3 },
    { def: 'strigian-oracle', n: 3 },
    { def: 'high-note', n: 2 },
    { def: 'fanfare', n: 2 },
    { def: 'hunting-dog', n: 2 },
    { def: 'industrious-mechsmith', n: 2 },
    { def: 'herald-of-the-emperor', n: 1 },
    { def: 'party-crasher', n: 1 },
    { def: 'faithful-manufactor', n: 2 },
    { def: 'meticulous-restorationist', n: 2 },
    { def: 'for-demacia', n: 1 },
    { def: 'moonlight-affliction', n: 1 },
  ],
  runes: [{ def: 'mind-rune', n: 6 }, { def: 'order-rune', n: 6 }],
  battlefields: ['black-rose-sanctum', 'ruined-monastery', 'valley-of-idols'],
};

export const EVELYNN_PRECON: DeckList = {
  name: 'Evelynn Showdown Deck',
  source: 'precon',
  legend: 'evelynn-agonys-embrace',
  championOptions: ['evelynn-consuming', 'evelynn-in-control', 'evelynn-entrancing'],
  // Hidden lets it be hidden from the Champion Zone [811.1.b].
  chosenChampion: 'evelynn-entrancing',
  main: [
    // Champion Options
    { def: 'evelynn-consuming', n: 1 },
    { def: 'evelynn-in-control', n: 1 },
    { def: 'evelynn-entrancing', n: 2 },
    // Main Deck
    { def: 'last-caress', n: 1 },
    { def: 'bushwhack-trap', n: 1 },
    { def: 'ksante-courageous', n: 1 },
    { def: 'gutter-guardian', n: 2 },
    { def: 'demon-shade', n: 1 },
    { def: 'the-good-stuff', n: 1 },
    { def: 'elnuk-herd', n: 2 },
    { def: 'reckless-innovator', n: 2 },
    { def: 'wind-and-ghosts', n: 2 },
    { def: 'pitiless-stalker', n: 1 },
    { def: 'sneaky-zeebles', n: 3 },
    { def: 'siren-of-the-shallows', n: 3 },
    { def: 'hold-em', n: 2 },
    { def: 'the-waters-wage', n: 2 },
    { def: 'momentary-companion', n: 2 },
    { def: 'suave-negotiator', n: 2 },
    { def: 'pakaa-cub', n: 2 },
    { def: 'wrath-of-the-freljord', n: 2 },
    { def: 'black-market-broker', n: 2 },
    { def: 'sirens-song', n: 2 },
  ],
  runes: [{ def: 'body-rune', n: 6 }, { def: 'chaos-rune', n: 6 }],
  battlefields: ['bandle-scouts-academy', 'rakelstake', 'bandle-tree'],
};

export const PRECONS: Precon[] = [
  { id: 'seraphine', product: 'Radiance Showdown Deck: Seraphine', set: 'rad', releases: '2026-10-23',
    source: SOURCE, tokens: ['3 Mech // Recruit', '3 Bird // Buff'], deck: SERAPHINE_PRECON },
  { id: 'evelynn', product: 'Radiance Showdown Deck: Evelynn', set: 'rad', releases: '2026-10-23',
    source: SOURCE, tokens: ['5 Gold // Bomb'], deck: EVELYNN_PRECON },
];
