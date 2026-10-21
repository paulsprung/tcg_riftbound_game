import { readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { GAME, SRC, rel, tsFiles } from './helpers/sources.ts';

/*
 * §2.2 / §14.2: who may import what. The engine is self-contained (no React,
 * no DOM, nothing from the app around it); the AI can't build a GameState
 * from setup data, so the only full state it ever holds is one it sampled
 * from its own view (§11.3); card definitions use only the effect language;
 * the UI reaches the engine through its public API alone.
 *
 * Rules about folders that don't exist yet (ai, cards/defs, src/play) are
 * checked as soon as files appear in them.
 */

interface Import { from: string; spec: string; to: string | null }   // to: resolved path, null for a package

function importsOf(file: string): Import[] {
  const info = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
  return info.importedFiles.map(({ fileName: spec }) => ({
    from: file, spec, to: spec.startsWith('.') ? resolve(dirname(file), spec) : null,
  }));
}

const inside = (path: string, dir: string) => path === dir || path.startsWith(dir + sep);
const show = (i: Import) => `${rel(i.from)} imports '${i.spec}'`;

const game = tsFiles(GAME).flatMap(importsOf);
const under = (dir: string) => game.filter((i) => inside(i.from, join(GAME, dir)));

/* Modules that build a GameState from setup data (§2.2). */
const STATE_BUILDERS = ['index.ts', 'core/create.ts', 'state/blank.ts', 'rules/setup.ts', 'record.ts']
  .map((f) => join(GAME, f));
const DSL = ['dsl/builders.ts', 'dsl/ast.ts'].map((f) => join(GAME, f));

describe('engine boundaries (§2.2)', () => {
  it('reads the engine imports', () => {
    expect(game.length).toBeGreaterThan(20);
  });

  it('src/game imports nothing outside itself: no packages, no app code', () => {
    expect(game.filter((i) => i.to === null || !inside(i.to, GAME)).map(show)).toEqual([]);
  });

  it('src/game/ai never imports createGame or anything that builds a GameState', () => {
    expect(under('ai').filter((i) => i.to !== null && STATE_BUILDERS.includes(i.to)).map(show)).toEqual([]);
  });

  it('card definitions import only the effect language', () => {
    const defs = [...under('cards/defs'), ...under('cards/drafts')];
    expect(defs.filter((i) => i.to === null || !DSL.includes(i.to)).map(show)).toEqual([]);
  });

  it('src/play reaches the engine only through src/game/index.ts (the AI through its worker)', () => {
    const play = tsFiles(join(SRC, 'play')).flatMap(importsOf).filter((i) => i.to !== null && inside(i.to, GAME));
    const allowed = (i: Import) => i.to === join(GAME, 'index.ts')
      || (rel(i.from) === 'src/play/host/ai.worker.ts' && inside(i.to!, join(GAME, 'ai')));
    expect(play.filter((i) => !allowed(i)).map(show)).toEqual([]);
  });
});
