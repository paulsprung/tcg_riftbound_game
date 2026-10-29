import { collection } from '../collection/store.ts';
import type { Card, CardDb } from '../data/types.ts';
import { rank } from '../showcase/rank.ts';
import { DEMO } from './demo.ts';

const KEY = 'riftbound-sim:demo-showcase';

/**
 * The preview puts your five best cards on show the first time, so the
 * profile and the home page have something to show. Once; what you change
 * afterwards stays.
 */
export function seedDemoShowcase(db: CardDb) {
  if (!DEMO) return;
  try { if (localStorage.getItem(KEY)) return; } catch { return; }
  const own = collection.get();
  if (own.showcase.length > 0 || !own.starter) return;
  const byId = new Map(db.cards.map((c) => [c.id, c]));
  const best: { card: Card; foil: boolean }[] = [];
  for (const [id, o] of Object.entries(own.cards)) {
    const card = byId.get(id);
    if (!card || card.type === 'Rune' || card.type === 'Battlefield') continue;
    if (o.foil > 0) best.push({ card, foil: true });
    else if (o.normal > 0) best.push({ card, foil: false });
  }
  best.sort((a, b) => rank(b.card, b.foil) - rank(a.card, a.foil));
  if (best.length === 0) return;
  for (const b of best.slice(0, 5)) collection.display({ kind: 'raw', cardId: b.card.id, foil: b.foil });
  try { localStorage.setItem(KEY, '1'); } catch { /* per session */ }
}
