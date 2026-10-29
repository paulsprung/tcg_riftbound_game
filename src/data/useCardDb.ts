import { useEffect, useState } from 'react';
import { ownUrl } from './hosts.ts';
import type { Card, CardDb } from './types.ts';

export type DbState =
  | { status: 'loading' }
  | { status: 'missing'; error: string }
  | { status: 'ready'; db: CardDb; byId: Map<string, Card> };

let cached: Promise<DbState> | null = null;

function load(): Promise<DbState> {
  cached ??= fetch(`${import.meta.env.BASE_URL}data/cards.json`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const db = (await res.json()) as CardDb;
      // the symbols through this site too (data/hosts.ts); card art goes through imageAt
      for (const k of ['rarities', 'domains'] as const) for (const sym of Object.values(db.symbols[k])) sym.icon = ownUrl(sym.icon);
      for (const [g, u] of Object.entries(db.symbols.glyphs ?? {})) db.symbols.glyphs![g] = ownUrl(u);
      return { status: 'ready', db, byId: new Map(db.cards.map((c) => [c.id, c])) } as DbState;
    })
    .catch((err: unknown) => {
      cached = null;   // let a later mount try again
      return { status: 'missing', error: err instanceof Error ? err.message : String(err) } as DbState;
    });
  return cached;
}

export function useCardDb(): DbState {
  const [state, setState] = useState<DbState>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    load().then((s) => alive && setState(s));
    return () => { alive = false; };
  }, []);
  return state;
}
