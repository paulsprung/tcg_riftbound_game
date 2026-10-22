import { decide, defsHash, type AgentConfig, type AgentReply } from '../../game/ai/agent.ts';
import type { PlayerView } from '../../game/index.ts';

export type { AgentConfig, AgentReply, AgentStats, AiLevel } from '../../game/ai/agent.ts';

/*
 * The computer opponent's worker (§11.2): the same src/game code, bundled
 * into a Web Worker so a decision never blocks the page. The protocol is
 * one request, one answer; the agent is a pure function of the view, its
 * configuration and its seed, so the host's local fallback (the same
 * handler, called on the main thread) gives the same answers.
 *
 * The handler refuses a view built by other card definitions: a stale
 * worker chunk must never simulate different card behaviour.
 */

export type AiRequest =
  | { t: 'hello' }
  | { t: 'decide'; id: number; cfg: AgentConfig; view: PlayerView };

export type AiResponse =
  | { t: 'ready'; defsHash: string }
  | { t: 'choice'; id: number; reply: AgentReply }
  | { t: 'error'; id: number; message: string };

export function handleAi(m: AiRequest): AiResponse {
  if (m.t === 'hello') return { t: 'ready', defsHash: defsHash() };
  try {
    if (m.view.defsHash && m.view.defsHash !== defsHash()) {
      return { t: 'error', id: m.id, message: `card definitions differ (${m.view.defsHash} vs ${defsHash()})` };
    }
    return { t: 'choice', id: m.id, reply: decide(m.cfg, m.view) };
  } catch (e) {
    return { t: 'error', id: m.id, message: e instanceof Error ? e.message : String(e) };
  }
}

// Inside a worker: answer messages. Imported on the main thread (the
// fallback), this does nothing.
const scope = globalThis as unknown as { WorkerGlobalScope?: unknown; postMessage?: (m: unknown) => void;
  onmessage?: ((e: MessageEvent<AiRequest>) => void) | null };
if (typeof scope.WorkerGlobalScope !== 'undefined') {
  scope.onmessage = (e) => scope.postMessage!(handleAi(e.data));
}
