import type { CoachStep } from './coach.ts';

/** A tutorial step's prompt (tutorial/coach.ts). */
export function CoachBubble({ step, onNext }: { step: CoachStep; onNext?: () => void }) {
  return (
    <div className={`coach coach--${step.anchor ?? 'prompt'}`} role="note" aria-live="polite" data-step={step.id}>
      {step.title && <strong className="coach__title">{step.title}</strong>}
      <p className="coach__text">{step.text}</p>
      {step.next && onNext && <button type="button" className="btn btn--small btn--primary" onClick={onNext}>Next</button>}
    </div>
  );
}
