import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { CoachStep } from './coach.ts';

/*
 * A tutorial step as a pop-up that explains the game (tutorial/coach.ts):
 * next to the thing it is about, never over it, with an arrow pointing at
 * it; a step with nothing to point at (or one that only explains) opens in
 * the middle with the board dimmed behind it. The target is found by the
 * data attributes every clickable thing carries.
 */

const GAP = 16;
const MARGIN = 10;

interface Box { x: number; y: number; w: number; h: number }
type Side = 'above' | 'below' | 'left' | 'right' | 'center' | 'top';

function targetOf(stage: HTMLElement, step: CoachStep): HTMLElement | null {
  const h = step.highlight;
  if (!h) return null;
  const q: string[] = [];
  for (const id of h.objs ?? []) q.push(`[data-obj="${id}"]`);
  for (const k of h.keys ?? []) q.push(`[data-key="${CSS.escape(k)}"]`);
  for (const l of h.lanes ?? []) q.push(`[data-lane="${l}"]`);
  for (const sel of q) {
    const el = stage.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

/** Where the target is, in the stage's own pixels (the page may be scaled). */
function boxOf(stage: HTMLElement, el: HTMLElement): Box {
  const s = stage.getBoundingClientRect(), r = el.getBoundingClientRect();
  const k = s.width / stage.offsetWidth || 1;
  return { x: (r.left - s.left) / k, y: (r.top - s.top) / k, w: r.width / k, h: r.height / k };
}

function place(stage: { w: number; h: number }, t: Box, pop: { w: number; h: number }): { side: Side; x: number; y: number } {
  const cx = Math.min(Math.max(t.x + t.w / 2 - pop.w / 2, MARGIN), stage.w - pop.w - MARGIN);
  const cy = Math.min(Math.max(t.y + t.h / 2 - pop.h / 2, MARGIN), stage.h - pop.h - MARGIN);
  const tries: { side: Side; x: number; y: number }[] = [
    { side: 'above', x: cx, y: t.y - pop.h - GAP },
    { side: 'below', x: cx, y: t.y + t.h + GAP },
    { side: 'left', x: t.x - pop.w - GAP, y: cy },
    { side: 'right', x: t.x + t.w + GAP, y: cy },
  ];
  const fits = (p: { x: number; y: number }) => p.x >= MARGIN && p.y >= MARGIN && p.x + pop.w <= stage.w - MARGIN && p.y + pop.h <= stage.h - MARGIN;
  return tries.find(fits) ?? { side: 'top', x: (stage.w - pop.w) / 2, y: MARGIN * 2 };
}

export function CoachPopup({ step, stage, onNext }: { step: CoachStep; stage: RefObject<HTMLElement | null>; onNext?: () => void }) {
  const pop = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ side: Side; x: number; y: number; ax: number; ay: number } | null>(null);
  const explain = step.anchor === 'top' || !!step.next;

  useLayoutEffect(() => {
    const st = stage.current, el = pop.current;
    if (!st || !el) return;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const t = step.anchor === 'top' ? null : targetOf(st, step);
      const dims = { w: el.offsetWidth, h: el.offsetHeight };
      const room = { w: st.offsetWidth, h: st.offsetHeight };
      if (!t) {
        const next = step.next || step.anchor === 'top'
          ? { side: 'center' as Side, x: (room.w - dims.w) / 2, y: (room.h - dims.h) / 2, ax: 0, ay: 0 }
          : { side: 'top' as Side, x: (room.w - dims.w) / 2, y: room.h * 0.34, ax: 0, ay: 0 };
        setAt((p) => (p && p.side === next.side && Math.abs(p.x - next.x) < 1 && Math.abs(p.y - next.y) < 1 ? p : next));
        return;
      }
      const box = boxOf(st, t);
      const p = place(room, box, dims);
      // the arrow points from the pop-up's edge at the middle of the target
      const ax = Math.min(Math.max(box.x + box.w / 2 - p.x, 18), dims.w - 18);
      const ay = Math.min(Math.max(box.y + box.h / 2 - p.y, 18), dims.h - 18);
      const next = { ...p, ax, ay };
      setAt((q) => (q && q.side === next.side && Math.abs(q.x - next.x) < 1 && Math.abs(q.y - next.y) < 1 ? q : next));
    };
    measure();
    const id = setInterval(measure, 250);
    const ro = new ResizeObserver(measure);
    ro.observe(st);
    return () => { alive = false; clearInterval(id); ro.disconnect(); };
  }, [step, stage]);

  useEffect(() => {
    if (!explain || !onNext) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); onNext(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [explain, onNext]);

  const side = at?.side ?? 'center';
  const style = { left: at?.x ?? 0, top: at?.y ?? 0, visibility: at ? 'visible' : 'hidden',
    '--ax': `${at?.ax ?? 0}px`, '--ay': `${at?.ay ?? 0}px` } as CSSProperties;
  return (
    <>
      {step.anchor === 'top' || (step.next && side === 'center') ? <div className="coach-dim" aria-hidden /> : null}
      <div ref={pop} className="coach-pop" data-side={side} role="note" aria-live="polite" data-step={step.id} style={style}>
        <span className="coach-pop__arrow" aria-hidden />
        {step.title && <strong className="coach-pop__title">{step.title}</strong>}
        <p className="coach-pop__text">{step.text}</p>
        {step.next && onNext && <button type="button" className="btn btn--small btn--cta" onClick={onNext} autoFocus>Got it</button>}
      </div>
    </>
  );
}
