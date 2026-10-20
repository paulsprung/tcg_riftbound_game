import type { Card, CardDb, Rarity } from './types.ts';
import { boosterSet } from '../pack/packConfig.ts';
import { finishFor, type Finish } from '../pack/generate.ts';

/** Riot's own rarity colours, from the gallery's rarity icons. */
export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#A4B8AA',
  uncommon: '#41B4B8',
  rare: '#B881A9',
  epic: '#B8794C',
  showcase: '#B89D3B',
  promo: '#9aa7c7',
  unknown: '#888888',
};

/** Rune colours as printed: Fury red, Calm green, Mind blue, Body orange,
    Chaos purple, Order gold. */
export const DOMAIN_COLOR: Record<string, string> = {
  fury: '#e0473f',
  calm: '#4fb27a',
  mind: '#3f8fe0',
  body: '#e08a3a',
  chaos: '#9b5de5',
  order: '#d9b74a',
  colorless: '#9aa3ad',
};

export const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'showcase', 'promo', 'unknown'];

export const VARIANT_LABEL: Record<Card['variant'], string> = {
  base: 'Standard',
  'alt-art': 'Alternate art',
  overnumbered: 'Overnumbered',
  signature: 'Signature',
  promo: 'Promo',
};

export function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** The finish a card has when you are just looking at it: the printing
    it most commonly comes in (rares and up are always foil). */
export function defaultFinish(card: Card, foil = false): Finish {
  return finishFor(card, foil, boosterSet(card.setId)?.pack);
}

/** Can this card exist in both a plain and a foil printing? */
export function hasFoilToggle(card: Card): boolean {
  return defaultFinish(card, false) === 'none';
}

export function symbolFor(db: CardDb, kind: 'rarities' | 'domains', key: string) {
  return db.symbols?.[kind]?.[key.toLowerCase()];
}
