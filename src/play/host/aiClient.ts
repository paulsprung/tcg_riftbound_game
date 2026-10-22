import type { PlayerView } from '../../game/index.ts';
import { handleAi, type AgentConfig, type AgentReply, type AiRequest, type AiResponse } from './ai.worker.ts';

/*
 * How the host reaches the computer opponent (§11.2): a Web Worker when the
 * page can start one, else the same handler on the main thread. Either
 * way an answer is a pure function of (configuration, view), so which one
 * ran never changes the game.
 *
 * The self-contained preview build inlines the worker as a blob (no chunk
 * files can be published); a host page that forbids blob workers, or a
 * worker that doesn't say hello in time, falls back to local. A worker
 * that errs or is late on one decision is retired the same way.
 */

export interface AiClient {
  readonly mode: 'worker' | 'local';
  decide(cfg: AgentConfig, view: PlayerView): Promise<AgentReply>;
  dispose(): void;
}

/** The agent on the calling thread (tests, previews without workers). */
export function localAi(): AiClient {
  return {
    mode: 'local',
    decide(cfg, view) {
      const r = handleAi({ t: 'decide', id: 0, cfg, view });
      return r.t === 'choice' ? Promise.resolve(r.reply) : Promise.reject(new Error(r.t === 'error' ? r.message : 'no answer'));
    },
    dispose() {},
  };
}

/** Answers synchronously: for tests and the sync host path. */
export function decideNow(cfg: AgentConfig, view: PlayerView): AgentReply {
  const r = handleAi({ t: 'decide', id: 0, cfg, view });
  if (r.t !== 'choice') throw new Error(r.t === 'error' ? r.message : 'no answer');
  return r.reply;
}

async function makeWorker(): Promise<Worker> {
  if (import.meta.env.VITE_PREVIEW) {
    const { default: W } = await import('./ai.worker.ts?worker&inline');
    return new W();
  }
  return new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
}

const HELLO_MS = 4000;
const DECIDE_MS = 8000;

/** A worker client that falls back to local for good on any failure. */
export async function createAi(): Promise<AiClient> {
  if (typeof Worker === 'undefined') return localAi();
  let w: Worker;
  try {
    w = await makeWorker();
  } catch {
    return localAi();
  }
  const local = localAi();
  let broken = false;
  let next = 1;
  const waiting = new Map<number, (r: AiResponse) => void>();
  w.onmessage = (e: MessageEvent<AiResponse>) => {
    const r = e.data;
    const id = r.t === 'ready' ? 0 : r.id;
    const fn = waiting.get(id);
    waiting.delete(id);
    fn?.(r);
  };
  const fail = () => {
    broken = true;
    for (const fn of waiting.values()) fn({ t: 'error', id: -1, message: 'worker failed' });
    waiting.clear();
    try { w.terminate(); } catch { /* gone already */ }
  };
  w.onerror = fail;
  const ask = (m: AiRequest, id: number, ms: number) => new Promise<AiResponse>((resolve) => {
    const t = setTimeout(() => { waiting.delete(id); resolve({ t: 'error', id, message: 'timeout' }); }, ms);
    waiting.set(id, (r) => { clearTimeout(t); resolve(r); });
    try { w.postMessage(m); } catch { clearTimeout(t); waiting.delete(id); resolve({ t: 'error', id, message: 'post failed' }); }
  });
  const hello = await ask({ t: 'hello' }, 0, HELLO_MS);
  if (hello.t !== 'ready') { fail(); return local; }
  const client: AiClient = {
    get mode() { return broken ? 'local' as const : 'worker' as const; },
    async decide(cfg, view) {
      if (broken) return local.decide(cfg, view);
      const id = next++;
      const r = await ask({ t: 'decide', id, cfg, view }, id, DECIDE_MS);
      if (r.t === 'choice') return r.reply;
      fail();
      return local.decide(cfg, view);
    },
    dispose() { fail(); },
  };
  return client;
}
