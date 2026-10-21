/*
 * Corrections the oracle build applies on top of cards.json (§9.1). Each
 * row names its card, what is wrong in the data and where the right value
 * comes from. A row must still be needed: the build refuses to run when a
 * row no longer matches the data (the text it fixes is gone, the type is
 * already there), so a repaired upstream record shows up as a redundant
 * row to delete instead of a silent double fix. The oracle lists the rows
 * it applied in OracleCard.fixes.
 *
 * Rows are plain data so the build script and the tests share them.
 */
import type { CardType, DefId } from '../state/types.ts';

interface RowBase {
  id: string;
  def: DefId;
  /** What is wrong with the data. */
  why: string;
  /** Where the correct value comes from. */
  source: string;
}

export type OverrideRow = RowBase & (
  /** Replace `find` (which must occur in the oracle text) with `replace`. */
  | { kind: 'text'; find: string; replace: string }
  /** Add card types the data leaves out [177–178]. */
  | { kind: 'types'; add: CardType[] }
  /** A keyword printed at the start of a line without its brackets. */
  | { kind: 'bracket'; keyword: string }
);

export const OVERRIDES: OverrideRow[] = [
  {
    id: 'rousing-display-disa', def: 'rousing-display', kind: 'text',
    find: 'instead.disa', replace: 'instead.',
    why: 'the RAD record ends in a stray "disa"',
    source: 'the printed card (RAD-127); design §9.5 #12',
  },
  {
    id: 'wraith-of-echoes-another', def: 'wraith-of-echoes', kind: 'text',
    find: 'The first time a friendly unit dies each turn',
    replace: 'The first time another friendly unit dies each turn',
    why: 'the data has the printed wording; the Core Rules quote the current one',
    source: 'Core Rules 2026-10-09, [383.1.b] example',
  },
  {
    id: 'patched-porobot-gear', def: 'patched-porobot', kind: 'types', add: ['gear'],
    why: 'cards.json lists it as a Unit only',
    source: 'Radiance overview: "Gear Units were introduced in Vendetta with the Patched Porobot"; [178]',
  },
  {
    id: 'laurent-bladekeeper-ganking', def: 'laurent-bladekeeper', kind: 'bracket', keyword: 'Ganking',
    why: 'the keyword is printed without brackets in the data', source: 'the printed card (SFD-096)',
  },
  {
    id: 'windsinger-hidden', def: 'windsinger', kind: 'bracket', keyword: 'Hidden',
    why: 'the keyword is printed without brackets in the data', source: 'the printed card (SFD-138)',
  },
  {
    id: 'jagged-cutlass-equip', def: 'jagged-cutlass', kind: 'bracket', keyword: 'Equip',
    why: 'the keyword is printed without brackets in the data', source: 'the printed card (VEN-073)',
  },
];
