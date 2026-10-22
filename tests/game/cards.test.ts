import { describe, expect, it } from 'vitest';
import { abilitiesOf, abilityById, allDefs, defsHash } from '../../src/game/cards/registry.ts';
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

  it('the Seraphine deck\'s spells with definitions are the ones M1.2 can execute', () => {
    const spells = allDefs().filter((d) => d.spell).map((d) => d.id).sort();
    expect(spells).toEqual(['burn-away', 'encore', 'high-note', 'moonlight-affliction', 'raucous-anthem', 'supernova']);
    const inDeck = SERAPHINE.main.map((e) => e.def);
    for (const d of allDefs()) if (d.id !== 'pitiless-stalker' && !d.id.includes('-sanctum') && !d.id.includes('monastery')
      && !d.id.includes('valley')) expect(inDeck, d.id).toContain(d.id);
  });

  it('[§4.9] a game records the hash of the definitions in effect', () => {
    const s = createGame({ seed: 1, decks: [SERAPHINE, SERAPHINE], firstPlayer: 0 }).state;
    expect(s.defsHash).toBe(defsHash());
    expect(s.defsHash).toMatch(/^[0-9a-f]{16}$/);
  });
});
