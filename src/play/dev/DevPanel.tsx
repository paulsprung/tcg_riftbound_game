import { useState } from 'react';
import { ENGINE_VERSION, type GameRecord } from '../../game/index.ts';
import type { GameHost, HostSnapshot } from '../host/GameHost.ts';
import { nameOf, type CardIndex } from '../model/cards.ts';
import { copyText } from '../model/report.ts';

/*
 * The DEV panel (§12.9), hidden by default (Ctrl+Shift+D or the settings'
 * dev flag): the engine version and seed, the pending decision with its
 * raw option keys, the computer's reasoning (§11.9: the options it weighed
 * and their values, how it runs), the record to copy or a record to load,
 * and in development builds only, both hands.
 */

export function DevPanel({ host, snap, cards, onLoad, onClose }: {
  host: GameHost; snap: HostSnapshot; cards: CardIndex; onLoad: (r: GameRecord) => void; onClose: () => void;
}) {
  const [load, setLoad] = useState('');
  const [msg, setMsg] = useState('');
  const d = snap.view.pending;
  const stub = snap.view.opponentDecision;
  const truth = host.devState();
  return (
    <aside className="devpanel" aria-label="Developer tools">
      <header className="devpanel__head">
        <strong>DEV</strong>
        <span className="muted small">engine {ENGINE_VERSION} · seed {host.setup.seed} · AI {snap.aiMode ?? 'none'}</span>
        <button type="button" className="btn btn--small btn--ghost" onClick={onClose}>Close</button>
      </header>
      <section>
        <h3>Decision</h3>
        {d ? (
          <p className="small">#{d.id} {d.kind} by P{d.player} [{d.ctx.rule}]{d.batch ? ` · batch ${d.batch}` : ''}<br />
            <code>{d.options.map((o) => o.key + (o.ui ? '(ui)' : '')).join(' ')}</code></p>
        ) : stub ? <p className="small">P{stub.player} decides: {stub.kind} [{stub.ctx.rule}]</p> : <p className="small">none</p>}
        <p className="small muted">{snap.events.length} events seen · {host.record().answers.length} answers</p>
      </section>
      <section>
        <h3>Computer</h3>
        {snap.aiStats ? (
          <>
            <p className="small">{snap.aiStats.level} · {snap.aiStats.options} options · {snap.aiStats.rollouts} rollouts</p>
            <ol className="devpanel__top">
              {snap.aiStats.top.map((t) => <li key={t.key}><code>{t.key}</code> {t.value}</li>)}
            </ol>
          </>
        ) : <p className="small muted">No decision weighed yet.</p>}
      </section>
      {truth && (
        <section>
          <h3>Both hands (dev build)</h3>
          {truth.players.map((pl) => (
            <p key={pl.id} className="small">P{pl.id}: {pl.hand.map((id) => nameOf(cards, truth.objects[id].def)).join(', ') || '—'}</p>
          ))}
        </section>
      )}
      <section>
        <h3>Record</h3>
        <div className="devpanel__row">
          <button type="button" className="btn btn--small" onClick={async () => setMsg((await copyText(JSON.stringify(host.record()))) ? 'copied' : 'blocked')}>
            Copy record
          </button>
          <span className="small muted">{msg}</span>
        </div>
        <textarea rows={3} value={load} onChange={(e) => setLoad(e.target.value)} placeholder="Paste a record (or a rules report) to load it" />
        <button type="button" className="btn btn--small" disabled={!load.trim()} onClick={() => {
          try {
            const j = JSON.parse(load) as GameRecord & { record?: GameRecord };
            onLoad(j.record ?? j);
          } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
        }}>Load record</button>
      </section>
    </aside>
  );
}
