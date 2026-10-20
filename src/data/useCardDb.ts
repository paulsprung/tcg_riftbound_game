import { useEffect, useState } from 'react';
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
