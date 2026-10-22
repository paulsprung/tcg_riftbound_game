import { describe, expect, it } from 'vitest';
import { abilitiesOf, abilityById, allDefs, cardDef, defsHash } from '../../src/game/cards/registry.ts';
import { oracleCard } from '../../src/game/cards/oracle.ts';
import { createGame } from '../../src/game/index.ts';
import { SERAPHINE } from './helpers/decks.ts';

/*
 * Card definitions (§9.1, §14.6): each implements its oracle text word for
 * word, names abilities the registry can find, and the definitions in
 * effect are hashed into every game (§4.9).
 */

describe('card definitions', () => {
  it('each definition carries its card\'s oracle rules text', () => {
    for (const d of allDefs()) expect(d.text, d.id).toBe(oracleCard(d.id).rules);
  });

  it('every ability has a unique id the registry resolves; keyword abilities come from printed keywords', () => {
    const ids = allDefs().flatMap((d) => abilitiesOf(d.id).map((a) => a.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(abilityById(id)?.id).toBe(id);
    expect(abilitiesOf('concert-poster').map((a) => a.id)).toContain('concert-poster#kw:deploy');   // [830.1.b.4]
    expect(abilitiesOf('seraphine-inspiring').map((a) => a.id)).toContain('seraphine-inspiring#kw:disarm');   // [831.1.d]
  });

  it('[§13.2] every card of the Seraphine deck has a definition, nothing of it missing', () => {
    const deck = [SERAPHINE.legend, ...SERAPHINE.main.map((e) => e.def), ...SERAPHINE.battlefields];
    expect(new Set(deck).size).toBe(28);                            // the 28 entries of §13.2
    for (const def of deck) {
      const d = cardDef(def);
      expect(d, def).toBeDefined();
      expect(d!.missing, def).toBeUndefined();
      if (oracleCard(def).types.includes('spell')) expect(d!.spell, def).toBeDefined();
    }
    const others = allDefs().map((d) => d.id).filter((id) => !deck.includes(id)).sort();
    expect(others).toEqual(['deathgrip', 'hidden-blade', 'pitiless-stalker', 'sona-harmonious']);   // for the engine tests
  });

  it('[§4.9] a game records the hash of the definitions in effect', () => {
    const s = createGame({ seed: 1, decks: [SERAPHINE, SERAPHINE], firstPlayer: 0 }).state;
    expect(s.defsHash).toBe(defsHash());
    expect(s.defsHash).toMatch(/^[0-9a-f]{16}$/);
  });
});
