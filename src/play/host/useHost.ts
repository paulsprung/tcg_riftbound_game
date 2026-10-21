import { useEffect, useSyncExternalStore } from 'react';
import type { GameHost, HostSnapshot } from './GameHost.ts';

/** The host's current snapshot, re-rendering on every change. The host
    runs (the opponent answers) while a component shows it. */
export function useHost(host: GameHost): HostSnapshot {
  useEffect(() => {
    host.start();
    return () => host.stop();
  }, [host]);
  return useSyncExternalStore(host.subscribe, host.getSnapshot);
}
