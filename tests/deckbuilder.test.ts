import { describe, expect, it } from 'vitest';
import { fromSaved } from '../src/collection/store.ts';
import { available, missingCards, ownedDefs, ownPrintings } from '../src/decks/ownership.ts';
import { decks, emptyDeck } from '../src/decks/store.ts';
import { findCard, STARTERS, validateDeck, type DeckList } from '../src/game/index.ts';
import { builtInDeck, playerDecks } from '../src/play/host/decks.ts';

// A collection holding exactly one starter deck's cards, as grantStarter leaves it.
function collectionOf(d: DeckList) {
  const cards: Record<string, { normal: number; foil: number }> = {};
  const add = (def: string, n: number) => {
    const id = findCard(def)!.printings[0];
    cards[id] = { normal: (cards[id]?.normal ?? 0) + n, foil: 0 };
  };
  add(d.legend, 1);
  for (const e of [...d.main, ...d.runes]) add(e.def, e.n);
  for (const b of d.battlefields) add(b, 1);
  return fromSaved({ cards, starter: null });
}

const annie = STARTERS.find((s) => s.set !== 'ogs' && s.deck.battlefields.length === 3)!.deck;

describe('deck builder', () => {
  it('shows the printing picked for a card while owned, else the first owned, never a promo you lack', () => {
    const akali = 'akali-rogue-assassin';
    const d: DeckList = { ...annie, main: [{ def: akali, n: 1 }] };
    const coll = fromSaved({ cards: { 'ven-139-166': { normal: 1, foil: 0 }, 'pr-139a-166': { normal: 1, foil: 0 } }, starter: null });
    expect(ownPrintings(d, coll)[akali]).toEqual(['ven-139-166']);
    expect(ownPrintings({ ...d, printings: { [akali]: ['pr-139a-166'] } }, coll)[akali]).toEqual(['pr-139a-166']);
    const plain = fromSaved({ cards: { 'ven-139-166': { normal: 1, foil: 0 } }, starter: null });
    expect(ownPrintings({ ...d, printings: { [akali]: ['pr-139a-166'] } }, plain)[akali]).toEqual(['ven-139-166']);
  });

  it('counts copies by card across printings and gives basic runes for free', () => {
    const own = ownedDefs(collectionOf(annie));
    expect(own[annie.legend]).toBe(1);
    expect(available(own, 'fury-rune')).toBe(Infinity);
    expect(available(own, 'no-such-card')).toBe(0);
  });

  it('a deck made of owned cards misses nothing; one copy too many is reported', () => {
    const coll = collectionOf(annie);
    const own = ownedDefs(coll);
    expect(missingCards(annie, own)).toEqual([]);
    const greedy = { ...annie, main: annie.main.map((e, i) => (i === 0 ? { ...e, n: e.n + 1 } : e)) };
    expect(missingCards(greedy, own)).toEqual([{ def: annie.main[0].def, n: 1 }]);
    expect(Object.keys(ownPrintings(annie, coll))).toContain(annie.legend);
  });

  it('an empty deck is not legal; the starter list rebuilt by hand is', () => {
    const d = emptyDeck(annie.legend, 'Mine');
    const codes = validateDeck(d, 'sanctioned', { format: 'standard' }).filter((i) => i.severity === 'error').map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['mainSize', 'runes', 'battlefields', 'chosenChampion']));
    const rebuilt = { ...d, main: annie.main, runes: annie.runes, battlefields: annie.battlefields, chosenChampion: annie.chosenChampion };
    expect(validateDeck(rebuilt, 'sanctioned', { format: 'standard' }).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('a saved deck is playable by its id and listed among the player\'s ready decks', () => {
    const d = { ...emptyDeck(annie.legend, 'Saved'), main: annie.main, runes: annie.runes, battlefields: annie.battlefields, chosenChampion: annie.chosenChampion };
    decks.save(d);
    expect(builtInDeck(`my:${d.id}`)?.deck.name).toBe('Saved');
    expect(playerDecks(collectionOf(annie), true).map((b) => b.id)).toContain(`my:${d.id}`);
    expect(playerDecks(fromSaved({}), true).map((b) => b.id)).not.toContain(`my:${d.id}`);
    decks.remove(d.id);
    expect(builtInDeck(`my:${d.id}`)).toBeUndefined();
  });
});
