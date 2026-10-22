import { setEffects, useEffects } from './effects.ts';

/** The one card setting: effects (foil, tilt) on or off. In the header, and
    again inside the inspector, which covers the header while it is open. */
export function HoloSwitches({ compact = false }: { compact?: boolean }) {
  const fx = useEffects();
  return (
    <div className="foil-toggle" role="group" aria-label="Card effects">
      {!compact && <span className="foil-toggle__label">Effects</span>}
      {(['on', 'off'] as const).map((v) => (
        <button key={v} type="button" aria-pressed={fx === v} onClick={() => setEffects(v)}
          title={v === 'on' ? 'Foil and tilt on' : 'Still, flat cards: no foil, no tilt'}>
          {v === 'on' ? 'On' : 'Off'}
        </button>
      ))}
    </div>
  );
}
