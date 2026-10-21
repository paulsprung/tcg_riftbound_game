import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/* The repo's source files, for the tests that read code rather than run it
   (purity, mutation and boundary checks, §14.2). */

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const SRC = join(REPO, 'src');
export const GAME = join(SRC, 'game');

/** Every .ts / .tsx file under a directory, recursively; [] if it doesn't
    exist (yet). Declaration files are left out. */
export function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsFiles(path);
    return /\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

/** 'src/game/state/mut.ts', with forward slashes on every platform. */
export const rel = (file: string) => relative(REPO, file).split(sep).join('/');
