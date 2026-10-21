import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { GAME, REPO, rel, tsFiles } from './helpers/sources.ts';

/*
 * §14.2: the engine is a pure reducer (P1). Its code touches no clock, no
 * randomness but its own seeded generator, no browser or Node globals; its
 * state is plain JSON; and only state/mut.ts writes game state (P15).
 *
 * The checks read the code with the TypeScript compiler rather than with
 * regular expressions, so they follow aliases (`const o = s.objects[id];
 * o.exhausted = true` is caught) and ignore comments, strings and property
 * names that merely look like globals (DelayedAbility.window). A probe file
 * with one violation of each kind proves the checks actually bite.
 */

const PROBE = join(GAME, '__probe__.ts');
const PROBE_SRC = `
import type { GameObject, GameState } from './state/types.ts';
export function probe(s: GameState, id: number) {
  const o: GameObject = s.objects[id];
  o.exhausted = true;
  s.turn.n++;
  delete s.objects[id];
  s.frames.push();
  s.players[0].hand.splice(0, 1);
  Object.assign(s.turn, { n: 3 });
  const t = Date.now() + performance.now() + Math.random();
  setTimeout(() => window.document.title = String(t));
  return localStorage;
}
export interface ProbeState { ok: { n: number[] }; m: Map<string, number>; at: Date; f: () => void }
`;

const files = tsFiles(GAME);
const norm = (f: string) => f.split('\\').join('/');
const TYPES_FILE = norm(join(GAME, 'state', 'types.ts'));

const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, resolveJsonModule: true,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: ['node'], typeRoots: [join(REPO, 'node_modules', '@types')],
};
const host = ts.createCompilerHost(options);
const { getSourceFile, fileExists, readFile } = host;
host.getSourceFile = (name, lang, ...rest) =>
  norm(name) === norm(PROBE) ? ts.createSourceFile(name, PROBE_SRC, lang) : getSourceFile.call(host, name, lang, ...rest);
host.fileExists = (name) => norm(name) === norm(PROBE) || fileExists.call(host, name);
host.readFile = (name) => (norm(name) === norm(PROBE) ? PROBE_SRC : readFile.call(host, name));
const program = ts.createProgram([...files, PROBE], options, host);
const checker = program.getTypeChecker();

const where = (n: ts.Node) => {
  const sf = n.getSourceFile();
  const { line } = sf.getLineAndCharacterOfPosition(n.getStart());
  return `${rel(sf.fileName)}:${line + 1}`;
};

function walk(sf: ts.SourceFile, visit: (n: ts.Node) => void) {
  const go = (n: ts.Node) => { visit(n); ts.forEachChild(n, go); };
  go(sf);
}

// ---- forbidden globals ----

const FORBIDDEN = ['Date', 'performance', 'window', 'document', 'localStorage', 'sessionStorage', 'indexedDB',
  'navigator', 'setTimeout', 'setInterval', 'setImmediate', 'requestAnimationFrame', 'queueMicrotask', 'crypto',
  'fetch', 'XMLHttpRequest', 'globalThis', 'process'];

/** Declared only by the standard library or @types: a global. */
function isGlobal(sym: ts.Symbol | undefined): boolean {
  const decls = sym?.declarations ?? [];
  return decls.length > 0 && decls.every((d) => {
    const sf = d.getSourceFile();
    return program.isSourceFileDefaultLibrary(sf) || norm(sf.fileName).includes('/node_modules/');
  });
}

function impureUses(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  walk(sf, (n) => {
    if (ts.isIdentifier(n) && FORBIDDEN.includes(n.text)) {
      const parent = n.parent;
      const isMemberName = (ts.isPropertyAccessExpression(parent) && parent.name === n)
        || ((ts.isPropertySignature(parent) || ts.isPropertyAssignment(parent)) && parent.name === n);
      if (!isMemberName && isGlobal(checker.getSymbolAtLocation(n))) out.push(`${where(n)} ${n.text}`);
    }
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'random' && ts.isIdentifier(n.expression)
      && n.expression.text === 'Math' && isGlobal(checker.getSymbolAtLocation(n.expression))) {
      out.push(`${where(n)} Math.random`);
    }
  });
  return out;
}

// ---- writes to game state ----

/* State structures only state/mut.ts may write. The design names the first
   five (§2.2); the rest are the other records that live in GameState. */
const GUARDED = ['GameState', 'GameObject', 'PlayerState', 'BattlefieldState', 'TurnState', 'RunePool', 'IdCounters',
  'DamageMark', 'ChainItem', 'PlayContext', 'ContinuousEffect', 'DelayedAbility', 'ShowdownState', 'CombatState',
  'TurnLog', 'GameHistory', 'GameResult'];
/* Redaction writes into a copy made for one viewer, never the live state. */
const MAY_WRITE = ['src/game/state/mut.ts', 'src/game/core/view.ts', 'src/game/core/redact.ts'];
const MUTATORS = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'];

function isGuarded(t: ts.Type): boolean {
  if (t.isUnionOrIntersection()) return t.types.some(isGuarded);
  const sym = t.aliasSymbol ?? t.getSymbol();
  if (!sym || !GUARDED.includes(sym.getName())) return false;
  return (sym.declarations ?? []).some((d) => norm(d.getSourceFile().fileName) === TYPES_FILE);
}

const unwrap = (e: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e) ? unwrap(e.expression) : e;

/** Whether writing through `e` (an `x.f` or `x[k]`) writes into state: some
    object on the way, x or what x was read from, is a state structure. */
function writesState(e: ts.Expression, self: boolean): boolean {
  let cur = unwrap(e);
  if (self && isGuarded(checker.getTypeAtLocation(cur))) return true;
  while (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) {
    cur = unwrap(cur.expression);
    if (isGuarded(checker.getTypeAtLocation(cur))) return true;
  }
  return false;
}

const isAccess = (e: ts.Expression) => ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e);

function stateWrites(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const flag = (n: ts.Node, what: string) => out.push(`${where(n)} ${what}: ${n.getText().slice(0, 60)}`);
  walk(sf, (n) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const target = unwrap(n.left);
      if (isAccess(target) && writesState(target, false)) flag(n, 'assignment');
    } else if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n))
      && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) {
      const target = unwrap(n.operand);
      if (isAccess(target) && writesState(target, false)) flag(n, 'increment');
    } else if (ts.isDeleteExpression(n)) {
      const target = unwrap(n.expression);
      if (isAccess(target) && writesState(target, false)) flag(n, 'delete');
    } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const callee = n.expression;
      if (MUTATORS.includes(callee.name.text) && isAccess(unwrap(callee.expression))
        && writesState(callee.expression, false)) flag(n, `.${callee.name.text}()`);
      if (callee.name.text === 'assign' && ts.isIdentifier(callee.expression) && callee.expression.text === 'Object'
        && n.arguments[0] && writesState(n.arguments[0], true)) flag(n, 'Object.assign');
    }
  });
  return out;
}

// ---- the state is JSON ----

const NOT_JSON = ['Map', 'Set', 'WeakMap', 'WeakSet', 'ReadonlyMap', 'ReadonlySet', 'Date', 'RegExp', 'Promise',
  'Function', 'Symbol'];

/** Every type reachable from an interface that JSON can't carry. */
function nonJsonParts(file: string, name: string): string[] {
  const sf = program.getSourceFile(file);
  if (!sf) return [`${rel(file)} not found`];
  let root: ts.Type | null = null;
  walk(sf, (n) => {
    if (ts.isInterfaceDeclaration(n) && n.name.text === name) root = checker.getTypeAtLocation(n.name);
  });
  if (!root) return [`interface ${name} not found`];
  const out: string[] = [];
  const seen = new Set<ts.Type>();
  const visit = (t: ts.Type, path: string) => {
    if (seen.has(t)) return;
    seen.add(t);
    const opaque = ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike;
    if (t.flags & opaque) { out.push(`${path}: ${checker.typeToString(t)}`); return; }
    if (t.isUnionOrIntersection()) { t.types.forEach((u) => visit(u, path)); return; }
    if (!(t.flags & ts.TypeFlags.Object)) return;                    // string, number, boolean, null, literals
    const name = (t.aliasSymbol ?? t.getSymbol())?.getName();
    if (name && NOT_JSON.includes(name)) { out.push(`${path}: ${name}`); return; }
    if (t.getCallSignatures().length > 0) { out.push(`${path}: a function`); return; }
    if (checker.isArrayType(t) || checker.isTupleType(t)) {
      checker.getTypeArguments(t as ts.TypeReference).forEach((a) => visit(a, `${path}[]`));
      return;
    }
    for (const info of checker.getIndexInfosOfType(t)) visit(info.type, `${path}[k]`);
    for (const prop of checker.getPropertiesOfType(t)) {
      const decl = prop.valueDeclaration ?? prop.declarations?.[0];
      if (decl) visit(checker.getTypeOfSymbolAtLocation(prop, decl), `${path}.${prop.getName()}`);
    }
  };
  visit(root, name);
  return out;
}

describe('engine purity (§14.2)', () => {
  const game = files.map((f) => program.getSourceFile(f)!);
  const probe = program.getSourceFile(PROBE)!;

  it('reads the engine sources', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(game.every(Boolean)).toBe(true);
  });

  it('the checks catch a violation of each kind', () => {
    expect(impureUses(probe).map((v) => v.split(' ')[1]).sort()).toEqual(
      ['Date', 'Date', 'Math.random', 'localStorage', 'performance', 'setTimeout', 'window']);   // Date: a call, a type
    expect(stateWrites(probe)).toHaveLength(6);
    expect(nonJsonParts(PROBE, 'ProbeState'))
      .toEqual(['ProbeState.m: Map', 'ProbeState.at: Date', 'ProbeState.f: a function']);
  });

  it('uses no clock, no outside randomness and no browser or Node globals (P1)', () => {
    expect(game.flatMap(impureUses)).toEqual([]);
  });

  it('keeps nothing in the state that JSON cannot carry (P4)', () => {
    expect(nonJsonParts(join(GAME, 'state', 'types.ts'), 'GameState')).toEqual([]);
  });

  it('writes game state only through state/mut.ts (P15)', () => {
    const writers = game.filter((sf) => !MAY_WRITE.includes(rel(sf.fileName)));
    expect(writers.flatMap(stateWrites)).toEqual([]);
    const mut = game.find((sf) => rel(sf.fileName) === 'src/game/state/mut.ts')!;
    expect(stateWrites(mut).length).toBeGreaterThan(10);      // where the writes are, and the check sees them
  });
});
