import type { ReactNode } from 'react';

/** The panel that holds a setup step over the table (§12.1): the board
    stays visible behind it, dimmed. */
export function SetupSheet({ step, title, children }: { step: string; title: string; children: ReactNode }) {
  return (
    <div className="sheet" role="dialog" aria-label={title}>
      <div className="sheet__panel">
        <p className="eyebrow">{step}</p>
        <h2 className="sheet__title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** The buttons of a decision, in the order the engine listed the keys;
    the primary one takes the focus, so Enter answers with it. Keyed by
    option key, so a label that changes with the draft keeps the focus
    where the player left it. */
export function Buttons({ buttons, onCommit, disabled }: {
  buttons: { key: string | null; label: string; primary?: boolean; commit: string[] }[];
  onCommit: (keys: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="sheet__buttons">
      {buttons.map((b) => (
        <button key={b.key ?? 'commit'} type="button" className={`btn${b.primary ? ' btn--primary' : ''}`} disabled={disabled}
          autoFocus={b.primary} onClick={() => onCommit(b.commit)}>
          {b.label}
        </button>
      ))}
    </div>
  );
}
