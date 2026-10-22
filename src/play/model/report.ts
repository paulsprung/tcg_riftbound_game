import { ENGINE_VERSION, type GameRecord, type PlayerView } from '../../game/index.ts';
import type { LogLine } from './describe.ts';

/*
 * "Report a rules problem" (§4.9): the game's record (it replays the game
 * exactly), the decision on screen, the last 50 log lines with their rule
 * numbers and the player's own words, as one JSON text to paste into an
 * issue. Such reports become golden replays once the problem is fixed
 * (§14.8). Nothing private is added beyond what the record holds (the
 * seed replays both hands: say so in the dialog).
 */

export interface RulesReport {
  kind: 'riftbound-rules-report';
  v: 1;
  engine: string;
  at: string;
  description: string;
  turn: number;
  decision: { kind: string; rule: string; player: number } | null;
  log: string[];
  record: GameRecord;
}

export function rulesReport(o: { record: GameRecord; view: PlayerView; log: readonly LogLine[]; description: string; at: string }): RulesReport {
  const d = o.view.pending ?? o.view.opponentDecision;
  return {
    kind: 'riftbound-rules-report', v: 1, engine: ENGINE_VERSION, at: o.at, description: o.description.trim(),
    turn: o.view.turn.n,
    decision: d ? { kind: d.kind, rule: d.ctx.rule, player: d.player } : null,
    log: o.log.slice(-50).map((l) => (l.rule ? `${l.text} [${l.rule}]` : l.text)),
    record: o.record,
  };
}

/** Copies text to the clipboard: the async API, else a selected textarea. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* not allowed here: try the old way */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
