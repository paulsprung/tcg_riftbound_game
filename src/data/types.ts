/** Printed rarity, as the set's collector numbering assigns it. */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'showcase' | 'promo' | 'unknown';

/**
 * Which printing of a card this is. The base printing is the one in the
 * set's main numbering; the rest are the chase versions that sit on top.
 */
export type Variant = 'base' | 'alt-art' | 'overnumbered' | 'signature' | 'promo';

export interface Card {
  /** Stable id from the source, unique per printing (variants differ). */
  id: string;
  name: string;
  setId: string;
  setName: string;
  /** Printed collector code, e.g. "OGN-001/298". */
  code: string;
  /** Numeric collector number, for sorting. */
  number: number | null;
  rarity: Rarity;
  variant: Variant;
  /** Card type as printed: Unit, Spell, Gear, Rune, Battlefield, Legend... */
  type: string;
  /** Supertype line, e.g. Champion, Signature, Token. */
  supertype: string | null;
  domains: string[];
  energy: number | null;
  might: number | null;
  power: number | null;
  tags: string[];
  text: string;
  flavor: string;
  artist: string;
  image: string;
  /** Battlefields are printed sideways. */
  orientation: 'portrait' | 'landscape';
}

export interface SetInfo {
  id: string;
  name: string;
  cardCount: number;
}

export interface CardSymbol {
  label: string;
  icon: string;
  color: string | null;
}

/** What `npm run fetch-cards` writes to public/data/cards.json. */
export interface CardDb {
  generatedAt: string;
  source: string;
  sets: SetInfo[];
  cards: Card[];
  /** Official rarity and domain icons/colours, keyed by lower-case label. */
  symbols: { rarities: Record<string, CardSymbol>; domains: Record<string, CardSymbol> };
}
