import { useState } from 'react';
import type { GameRecord, PlayerView } from '../../game/index.ts';
import type { LogLine } from '../model/describe.ts';
import { copyText, rulesReport } from '../model/report.ts';

/*
 * The table's dialogs: the hot-seat handoff cover (§12.1), and "Report a
 * rules problem" (§4.9).
 */

/** Hot-seat: covers the table until the next player has the device. */
export function HandoffCover({ name, onTake }: { name: string; onTake: () => void }) {
  return (
    <div className="handoff" role="dialog" aria-label={`Pass the device to ${name}`}>
      <div className="handoff__panel">
        <p className="eyebrow">Hot-seat</p>
        <h2>Pass the device to {name}</h2>
        <p className="muted">The other player looks away: what is on the next screen is {name}'s alone (their hand).</p>
        <button type="button" className="btn btn--primary" onClick={onTake} autoFocus>I'm {name}: show my side</button>
      </div>
    </div>
  );
}

export function ReportDialog({ record, view, log, onClose }: {
  record: () => GameRecord; view: PlayerView; log: readonly LogLine[]; onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [json, setJson] = useState<string | null>(null);
  const copy = async () => {
    const out = JSON.stringify(rulesReport({ record: record(), view, log, description: text, at: new Date().toISOString() }));
    setJson(out);
    setStatus((await copyText(out)) ? 'copied' : 'failed');
  };
  return (
    <div className="sheet" role="dialog" aria-label="Report a rules problem">
      <div className="sheet__panel report">
        <p className="eyebrow">Report a rules problem</p>
        <h2 className="sheet__title">What went wrong?</h2>
        <p className="muted small">
          Describe what happened and what the rules say should have happened. The report copies the game's record
          (it replays the whole game, both hands included), the current decision and the last 50 log lines.
        </p>
        <textarea className="report__text" rows={5} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="e.g. My Steadfast Outrider should have had Tank when it defended [815]…" autoFocus />
        {status === 'copied' && <p className="small" role="status">Copied to the clipboard: paste it into an issue or a message.</p>}
        {status === 'failed' && json && (
          <>
            <p className="small" role="status">The clipboard is blocked here: select the text below and copy it.</p>
            <textarea className="report__json" rows={4} readOnly value={json} onFocus={(e) => e.currentTarget.select()} />
          </>
        )}
        <div className="sheet__buttons">
          <button type="button" className="btn btn--primary" onClick={copy}>Copy report</button>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
