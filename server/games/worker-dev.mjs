// The engine thread run from source (tests, `tsx server/main.ts`): TypeScript through tsx first.
import { register } from 'tsx/esm/api';

register();
await import('./worker.ts');
