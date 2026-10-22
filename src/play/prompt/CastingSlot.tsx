import type { CSSProperties } from 'react';
import { DOMAIN_COLOR, symbolFor } from '../../data/cardInfo.ts';
import type { CardDb } from '../../data/types.ts';
import { findCard, type PlayerView, type PowerReq } from '../../game/index.ts';
import { slotOf } from '../model/board.ts';
import { isRune, nameOf, type CardIndex } from '../model/cards.ts';
import { TableCard } from '../table/TableCard.tsx';

/*
 * The casting slot (§12.5 "Playing a card"): while the viewer is playing a
 * card or activating an ability, the card sits here with its cost as chips
 * (the total cost once step 3 has fixed it [356], else the printed one) and
 * the step of the play it is at. The choices themselves stay where they
 * are answered: glowing lanes and targets on the table, buttons and the
 * mode sheet in the prompt.
 */

const STEP: Record<string, string> = {
  location: 'Where it enters', target: 'Targets', mode: 'Modes', payment: 'Payment', optionalCost: 'Additional cost',
  showOff: 'Show Off', costObject: 'Cost', applyReplacement: 'Replacement', addAbility: 'Paying rune by rune',
  may: 'Optional', pickCard: 'Choose a card', predict: 'Predict',
};

export function powerChips(power: readonly PowerReq[], db: CardDb) {
  return power.map((p, i) => {
    const d = p.k === 'domain' ? p.d : null;
    const label = p.k === 'domain' ? p.d : p.k === 'anyOf' ? p.ds.join('/') : 'any';
    const sym = d ? symbolFor(db, 'domains', d) : undefined;
    return (
      <span key={i} className="cost-chip cost-chip--power" style={{ '--chip': d ? DOMAIN_COLOR[d] : '#9aa3ad' } as CSSProperties}
        title={`${label} Power`}>
        {sym && <img src={sym.icon} alt="" />}{sym ? '' : label}
      </span>
    );
  });
}

export function CastingSlot({ view, cards, db }: { view: PlayerView; cards: CardIndex; db: CardDb }) {
  const d = view.pending;
  if (!d) return null;
  const f = [...view.frames].reverse().find((fr) => fr.f === 'play' || fr.f === 'ability');
  if (!f || (f.f !== 'play' && f.f !== 'ability')) return null;
  const item = view.chain.find((it) => it.id === f.item);
  const objId = f.f === 'play' ? f.obj : f.src;
  const o = objId === null || objId === undefined ? undefined : view.objects[objId];
  if (!o || !('def' in o)) return null;
  const slot = slotOf(view, o.id, isRune);
  const printed = findCard(o.def)?.cost;
  const total = item?.play.cost;
  const energy = total?.energy ?? printed?.energy ?? 0;
  const power = total?.power ?? printed?.power ?? [];
  const changed = total && printed && (total.energy !== printed.energy || total.power.length !== printed.power.length);
  const at = STEP[d.kind] ?? null;
  const ability = f.f === 'ability';
  return (
    <aside className="casting" aria-label="Casting slot">
      <TableCard slot={slot} cards={cards} size="m" />
      <div className="casting__text">
        <p className="eyebrow">{ability ? 'Activating' : 'Playing'}</p>
        <strong className="casting__name">{nameOf(cards, o.def)}</strong>
        {!ability && (
          <span className="casting__cost" aria-label={`Cost ${energy} Energy${power.length ? ` and ${power.length} Power` : ''}`}>
            <span className="cost-chip cost-chip--energy" title="Energy">{energy}</span>
            {powerChips(power, db)}
            {changed && <span className="muted small"> (printed {printed!.energy}{printed!.power.length ? ` + ${printed!.power.length}` : ''})</span>}
          </span>
        )}
        <p className="casting__now">
          <span className="chip">{at ?? 'Choosing'}</span>
          {d.kind !== 'payment' && !ability && <span className="muted small"> then payment</span>}
        </p>
      </div>
    </aside>
  );
}
