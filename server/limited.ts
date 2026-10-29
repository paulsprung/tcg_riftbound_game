import type { DeckEntry, DeckList } from '../src/game/decks/decklist.ts';
import { defOfPrinting } from '../src/game/cards/oracle.ts';
import type { Domain } from '../src/game/state/types.ts';
import {
  autoBuild, BATTLEFIELDS, botPick, draftDone, limitedIssues, MAX_DOMAINS, newDraft, pick, sealedPool, type Draft, type LimitedFormat,
} from '../src/limited/limited.ts';
import { BOOSTER_SETS } from '../src/pack/packConfig.ts';
import type { Db } from './db.ts';
import { Refused, secureRandom, type Catalog } from './economy.ts';

/*
 * Limited pools on the server (Tournament Rules 602; the rules themselves are
 * src/limited/limited.ts). A casual pool is made on request: six boosters
 * opened (Sealed), or a draft with seven computer seats picked card by card
 * (Draft). A tournament's pools are made by the tournament (director.ts).
 * The player builds a deck from the pool; the server checks it against the
 * pool before any game. A player has one casual pool at a time: a new one
 * replaces it.
 */

const DOMAINS: Domain[] = ['fury', 'calm', 'mind', 'body', 'chaos', 'order'];

interface PoolRow { id: string; user_id: string; format: LimitedFormat; set_id: string; cards: string[]; draft: Draft | null; deck: DeckList | null; tournament_id: string | null }

/** What the player sees of a pool: during a draft only their own seat. */
export interface PoolView {
  id: string; format: LimitedFormat; setId: string; cards: string[]; deck: DeckList | null; tournament: string | null;
  draft: { round: number; pack: string[]; picks: string[]; deadline?: number } | null;
}

export function viewOf(p: PoolRow, seat = 0, deadline?: number): PoolView {
  const d = p.draft;
  return {
    id: p.id, format: p.format, setId: p.set_id, cards: p.cards, deck: p.deck, tournament: p.tournament_id,
    draft: d && !draftDone(d) ? { round: d.round, pack: d.picked[seat] ? [] : d.packs[seat], picks: d.picks[seat], ...(deadline ? { deadline } : {}) } : null,
  };
}

/** A deck as it came in, reduced to the shape a Limited deck has; anything else is refused. */
export function cleanDeck(raw: unknown): DeckList {
  const d = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max = 80) => (typeof v === 'string' && v.length <= max ? v : '');
  const rows = (v: unknown, max: number): DeckEntry[] => {
    if (!Array.isArray(v) || v.length > max) throw new Refused('A deck list of cards and counts');
    return v.map((e) => {
      const def = str((e as DeckEntry)?.def), n = (e as DeckEntry)?.n;
      if (!def || !Number.isInteger(n) || n < 1 || n > 99) throw new Refused('A deck list of cards and counts');
      return { def, n };
    });
  };
  const domains = Array.isArray(d.domains) ? d.domains.filter((x): x is Domain => DOMAINS.includes(x as Domain)) : [];
  if (domains.length > MAX_DOMAINS) throw new Refused(`Up to ${MAX_DOMAINS} domains`);
  const battlefields = Array.isArray(d.battlefields) ? d.battlefields.slice(0, BATTLEFIELDS).map((b) => str(b)) : [];
  return {
    name: str(d.name, 60) || 'Limited deck', source: 'custom', legend: str(d.legend), chosenChampion: str(d.chosenChampion),
    domains: [...new Set(domains)], main: rows(d.main, 200), runes: rows(d.runes, 6), battlefields,
  };
}

/** The deck with each card shown as a printing the pool holds. */
function withPoolPrintings(deck: DeckList, cards: string[]): DeckList {
  const printings: Record<string, string[]> = {};
  for (const id of cards) { const def = defOfPrinting(id); if (def) (printings[def] ??= []).push(id); }
  return { ...deck, printings };
}

export class LimitedService {
  constructor(private readonly db: Db, private readonly catalog: () => Promise<Catalog>) {}

  /** The card data pools are made from. */
  cards(): Promise<Catalog> { return this.catalog(); }

  /** A new casual pool; the player's earlier casual pool goes. */
  async start(userId: string, format: unknown, setId: unknown): Promise<PoolView> {
    if (format !== 'sealed' && format !== 'draft') throw new Refused('Sealed or Draft');
    if (!BOOSTER_SETS.some((s) => s.id === setId)) throw new Refused('No such set');
    const cat = await this.catalog();
    const sid = setId as string;
    const cards = format === 'sealed' ? sealedPool(cat.db, sid, secureRandom) : [];
    const draft = format === 'draft' ? newDraft(cat.db, sid, secureRandom) : null;
    await this.db.query('DELETE FROM limited_pools WHERE user_id = $1 AND tournament_id IS NULL', [userId]);
    const r = await this.db.query(`INSERT INTO limited_pools (user_id, format, set_id, cards, draft, deck) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, format, sid, JSON.stringify(cards), draft && JSON.stringify(draft), format === 'sealed' ? JSON.stringify(autoBuild(cards, 'sealed', cat.byId)) : null]);
    return viewOf(r.rows[0]);
  }

  async current(userId: string): Promise<PoolView | null> {
    const r = await this.db.query('SELECT * FROM limited_pools WHERE user_id = $1 AND tournament_id IS NULL ORDER BY created_at DESC LIMIT 1', [userId]);
    return r.rows[0] ? viewOf(r.rows[0]) : null;
  }

  async row(userId: string, poolId: string): Promise<PoolRow> {
    if (!/^[0-9a-f-]{36}$/.test(String(poolId))) throw new Refused('No such pool', 404);
    const r = await this.db.query('SELECT * FROM limited_pools WHERE id = $1 AND user_id = $2', [poolId, userId]);
    if (!r.rowCount) throw new Refused('No such pool', 404);
    return r.rows[0] as PoolRow;
  }

  /** A pick in a casual draft: the seven computer seats pick at once; the last pick makes the pool. */
  async pick(userId: string, poolId: string, card: unknown): Promise<PoolView> {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      const r = await c.query('SELECT * FROM limited_pools WHERE id = $1 AND user_id = $2 FOR UPDATE', [poolId, userId]);
      const p = r.rows[0] as PoolRow | undefined;
      if (!p || p.tournament_id) throw new Refused('No such draft', 404);
      if (!p.draft || draftDone(p.draft)) throw new Refused('The draft is over');
      const cat = await this.catalog();
      let d = pick(p.draft, 0, String(card));
      for (let s = 1; s < d.packs.length; s++) d = pick(d, s, botPick(cat.byId, d.packs[s], d.picks[s]));
      const done = draftDone(d);
      const cards = done ? d.picks[0] : p.cards;
      await c.query('UPDATE limited_pools SET draft = $2, cards = $3, deck = $4 WHERE id = $1',
        [p.id, JSON.stringify(d), JSON.stringify(cards), done ? JSON.stringify(autoBuild(cards, 'draft', cat.byId)) : null]);
      await c.query('COMMIT');
      return viewOf({ ...p, draft: d, cards, deck: done ? autoBuild(cards, 'draft', cat.byId) : null });
    } catch (err) { await c.query('ROLLBACK').catch(() => undefined); throw err; } finally { c.release(); }
  }

  /** The player's deck for a pool, checked against it (TR 602). */
  async saveDeck(userId: string, poolId: string, raw: unknown, open = true): Promise<PoolView> {
    const p = await this.row(userId, poolId);
    if (!open) throw new Refused('Decks are locked');
    if (p.draft && !draftDone(p.draft)) throw new Refused('Finish the draft first');
    const deck = cleanDeck(raw);
    const issues = limitedIssues(deck, p.cards, p.format);
    if (issues.length) throw new Refused(issues[0].message);
    await this.db.query('UPDATE limited_pools SET deck = $2 WHERE id = $1', [p.id, JSON.stringify(deck)]);
    return viewOf({ ...p, deck });
  }

  /** The deck a player brings to a Limited game, from a pool of theirs. */
  async deckFor(userId: string, poolId: string): Promise<{ deck: DeckList; format: LimitedFormat }> {
    const p = await this.row(userId, poolId);
    if (!p.deck) throw new Error('Build a deck from your pool first');
    const issues = limitedIssues(p.deck, p.cards, p.format);
    if (issues.length) throw new Error(`This deck can't be played: ${issues[0].message}`);
    return { deck: withPoolPrintings(p.deck, p.cards), format: p.format };
  }
}
