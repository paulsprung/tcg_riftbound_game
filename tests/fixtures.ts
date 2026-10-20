import type { Card } from '../src/data/types.ts';

/** Synthetic cards for unit tests only; never shipped to the app. */
export function makeCard(over: Partial<Card> & { id: string }): Card {
  return {
    name: over.id,
    setId: 'tst',
    setName: 'Test Set',
    code: `TST-${over.id}`,
    number: null,
    rarity: 'common',
    variant: 'base',
    type: 'Unit',
    supertype: null,
    domains: [],
    energy: null,
    might: null,
    power: null,
    tags: [],
    text: '',
    flavor: '',
    artist: '',
    image: '',
    orientation: 'portrait',
    ...over,
  };
}

export function makeSet(): Card[] {
  const cards: Card[] = [];
  const add = (n: number, over: Partial<Card>, prefix: string) => {
    for (let i = 0; i < n; i++) cards.push(makeCard({ id: `${prefix}${i}`, ...over }));
  };
  add(40, { rarity: 'common' }, 'c');
  add(30, { rarity: 'uncommon' }, 'u');
  add(20, { rarity: 'rare' }, 'r');
  add(10, { rarity: 'epic' }, 'e');
  add(8, { rarity: 'showcase', variant: 'alt-art' }, 's');
  add(4, { rarity: 'showcase', variant: 'overnumbered', type: 'Legend' }, 'o');
  add(2, { rarity: 'showcase', variant: 'signature' }, 'g');
  add(6, { rarity: 'common', type: 'Rune' }, 'n');
  add(6, { rarity: 'showcase', type: 'Rune', variant: 'alt-art' }, 'a');
  add(3, { rarity: 'common', type: 'Unit', supertype: 'Token' }, 't');
  cards.push(makeCard({ id: 'ult', code: 'TST-999/100', rarity: 'showcase', variant: 'overnumbered', type: 'Battlefield' }));
  return cards;
}
