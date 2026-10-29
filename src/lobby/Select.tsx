import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { viewport } from './scale.ts';

export interface Option { value: string; label: string }

/**
 * A drop-down in the look of the lobby. The browser's own list is white
 * and ignores the theme; this one is a listbox you can use with the mouse
 * or the keys (arrows, Home, End, Enter, Escape, type to jump).
 */
export function Select({ value, options, onChange, label, className = '' }: {
  value: string; options: Option[]; onChange: (v: string) => void; label: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, max: 320, up: false });
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  const show = () => {
    const rr = btn.current?.getBoundingClientRect();
    if (!rr) return;
    // the page is scaled: work in its own pixels
    const { s, h } = viewport();
    const r = { left: rr.left / s, top: rr.top / s, bottom: rr.bottom / s, width: rr.width / s };
    const below = h - r.bottom - 12, above = r.top - 12;
    const up = below < 200 && above > below;
    setBox({ left: r.left, top: up ? r.top : r.bottom, width: r.width, max: Math.min(340, up ? above : below), up });
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const close = (focus = true) => { setOpen(false); if (focus) btn.current?.focus(); };
  const pick = (i: number) => { onChange(options[i].value); close(); };

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const off = () => setOpen(false);
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('resize', off);
    window.addEventListener('blur', off);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('resize', off); window.removeEventListener('blur', off); };
  }, [open]);
  useLayoutEffect(() => { if (open) list.current?.querySelector('[data-on]')?.scrollIntoView({ block: 'nearest' }); }, [open, active]);

  const key = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(); }
      return;
    }
    const n = options.length;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + n) % n); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(n - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active); }
    else if (e.key === 'Tab') setOpen(false);
    else if (e.key.length === 1) {
      const at = options.findIndex((o, i) => i > active && o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      const first = at >= 0 ? at : options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (first >= 0) setActive(first);
    }
  };

  return (
    <>
      <button ref={btn} type="button" className={`sel ${className}`} aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        aria-controls={open ? id : undefined} onClick={() => (open ? close(false) : show())} onKeyDown={key}>
        <span>{current?.label}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && createPortal(
        <div ref={list} id={id} role="listbox" aria-label={label} className="sel__list" onKeyDown={key}
          style={{ left: box.left, minWidth: box.width, maxHeight: box.max, ...(box.up ? { bottom: viewport().h - box.top + 4 } : { top: box.top + 4 }) }}>
          {options.map((o, i) => (
            <div key={o.value} role="option" aria-selected={o.value === value} data-on={i === active ? '' : undefined}
              className="sel__opt" onPointerEnter={() => setActive(i)} onClick={() => pick(i)}>
              {o.label}
            </div>
          ))}
        </div>, document.querySelector('.app') ?? document.body)}
    </>
  );
}
