import { parentPort } from 'node:worker_threads';
import { Engine } from './engine.ts';

/* One engine thread: the games it was given, answering the pool's calls in order. */
const engine = new Engine();
type Op = 'create' | 'resume' | 'choose' | 'concede' | 'current' | 'history' | 'record' | 'drop';

parentPort!.on('message', (m: { id: number; op: Op; args: unknown[] }) => {
  try {
    const fn = engine[m.op] as (...a: unknown[]) => unknown;
    parentPort!.postMessage({ id: m.id, ok: true, value: fn.apply(engine, m.args) });
  } catch (err) {
    parentPort!.postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
