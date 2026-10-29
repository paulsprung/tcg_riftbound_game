import { availableParallelism } from 'node:os';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { Engine } from './engine.ts';

/*
 * The engine threads (docs/CAPACITY.md): one per core but one, which is
 * left to the web server and the database. A game lives in one thread for
 * its whole life, picked by its id, so its calls run in order. With zero
 * threads (tests) the games run on this thread.
 */

type Methods = Pick<Engine, 'create' | 'resume' | 'choose' | 'concede' | 'current' | 'history' | 'record' | 'drop'>;
export type EngineCall = { [K in keyof Methods]: (...a: Parameters<Methods[K]>) => Promise<ReturnType<Methods[K]>> };

function workerFile(): { file: string; execArgv: string[] } {
  // bundled: dist-server/worker.mjs next to main.mjs; from source: a bootstrap that loads the .ts through tsx
  const bundled = fileURLToPath(new URL('./worker.mjs', import.meta.url));
  if (existsSync(bundled)) return { file: bundled, execArgv: [] };
  return { file: fileURLToPath(new URL('./worker-dev.mjs', import.meta.url)), execArgv: [] };
}

export class EnginePool {
  private readonly workers: Worker[] = [];
  private readonly inline: Engine | null;
  private readonly waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void }>();
  private next = 1;
  /** Where each game lives. */
  private readonly home = new Map<string, number>();
  private turn = 0;

  constructor(threads = Math.max(1, availableParallelism() - 1)) {
    this.inline = threads === 0 ? new Engine() : null;
    const { file, execArgv } = workerFile();
    for (let i = 0; i < threads; i++) {
      const w = new Worker(file, { execArgv });
      w.on('message', (m: { id: number; ok: boolean; value?: unknown; error?: string }) => {
        const p = this.waiting.get(m.id);
        if (!p) return;
        this.waiting.delete(m.id);
        if (m.ok) p.ok(m.value); else p.fail(new Error(m.error));
      });
      w.on('error', (err) => console.error('engine thread failed:', err));
      w.unref();
      this.workers.push(w);
    }
  }

  get threads() { return this.workers.length; }

  private call(gameId: string, op: keyof Methods, args: unknown[]): Promise<unknown> {
    if (this.inline) {
      try { return Promise.resolve((this.inline[op] as (...a: unknown[]) => unknown).apply(this.inline, args)); }
      catch (err) { return Promise.reject(err); }
    }
    let w = this.home.get(gameId);
    if (w === undefined) { w = this.turn++ % this.workers.length; this.home.set(gameId, w); }
    if (op === 'drop') this.home.delete(gameId);
    const id = this.next++;
    return new Promise((ok, fail) => {
      this.waiting.set(id, { ok, fail });
      this.workers[w].postMessage({ id, op, args });
    });
  }

  readonly engine: EngineCall = new Proxy({} as EngineCall, {
    get: (_t, op: keyof Methods) => (gameId: string, ...rest: unknown[]) => this.call(gameId, op, [gameId, ...rest]),
  });

  async close() { await Promise.all(this.workers.map((w) => w.terminate())); }
}
