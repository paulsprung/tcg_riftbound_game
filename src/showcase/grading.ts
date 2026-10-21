/*
 * Card grading, the way the big grading houses do it: a card is measured
 * for centering and looked over for its corners, edges and surface; each
 * gets a subgrade, and the card one overall grade from 1 to 10. A grade
 * is final: the card is sealed in a slab with a numbered label.
 *
 * Pack-fresh cards are mostly high grades, so the rolls below lean that
 * way; a gem mint 10 is common enough to chase, a pristine 10 (every
 * subgrade a 10) is rare.
 */

/** The fictional grading house this simulator's slabs come from. */
export const GRADER = { name: 'Lumen Grading', short: 'LG' };

export interface Subgrades {
  centering: number;
  corners: number;
  edges: number;
  surface: number;
}

export interface Slab {
  /** Eight-digit certificate number, unique within a collection. */
  cert: string;
  cardId: string;
  foil: boolean;
  sub: Subgrades;
  /** Share of the border on the left and on the top, in percent:
      53 means 53/47. */
  lr: number;
  tb: number;
  /** Overall grade, 1 to 10. */
  grade: number;
  /** All four subgrades are 10. */
  pristine: boolean;
  gradedAt: number;
}

export const SUBGRADES: (keyof Subgrades)[] = ['centering', 'corners', 'edges', 'surface'];

const DESCRIPTOR: Record<number, string> = {
  10: 'Gem Mint', 9: 'Mint', 8: 'NM-MT', 7: 'Near Mint', 6: 'EX-MT',
  5: 'Excellent', 4: 'VG-EX', 3: 'Very Good', 2: 'Good', 1: 'Poor',
};

export function descriptor(s: Pick<Slab, 'grade' | 'pristine'>): string {
  return s.pristine ? 'Pristine' : DESCRIPTOR[s.grade] ?? '';
}

/** "53/47" */
export const ratio = (share: number) => `${share}/${100 - share}`;

/** Centering subgrade from the worse of the two axes, using the usual
    tolerances: 55/45 or better is a 10, 60/40 a 9, 65/35 an 8, ... */
export function centeringGrade(lr: number, tb: number): number {
  const off = Math.max(Math.abs(lr - 50), Math.abs(tb - 50));
  const steps: [number, number][] = [
    [2, 10], [5, 9.5], [7, 9], [10, 8.5], [12, 8], [15, 7.5], [20, 7], [25, 6.5],
    [30, 6], [35, 5], [40, 4],
  ];
  for (const [max, g] of steps) if (off <= max) return g;
  return 3;
}

/** Corners, edges and surface: weights for 10, 9.5, 9, ... of a card
    straight out of a pack. A foil's surface shows scratches more. */
const WEAR: [number, number][] = [
  [10, 48], [9.5, 30], [9, 11.5], [8.5, 4], [8, 3], [7.5, 1.5], [7, 1], [6, .5], [5, .3], [4, .2],
];
const FOIL_SURFACE: [number, number][] = [
  [10, 36], [9.5, 32], [9, 16], [8.5, 7], [8, 4], [7.5, 2], [7, 1.5], [6, .7], [5, .5], [4, .3],
];

function pick(table: [number, number][], r: number): number {
  const total = table.reduce((s, [, w]) => s + w, 0);
  let x = r * total;
  for (const [v, w] of table) { if ((x -= w) < 0) return v; }
  return table[table.length - 1][0];
}

/** An off-centre cut: mostly close, now and then badly off. */
function cut(random: () => number): number {
  const spread = random() < 0.92 ? 4 : 10;
  // a normal draw (Box-Muller) around the middle
  const n = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  return Math.round(Math.max(15, Math.min(85, 50 + n * spread)));
}

/** The overall grade: the subgrades weighed together (surface counts most),
    and never more than half a grade above the weakest one. */
export function overall(sub: Subgrades): number {
  const avg = sub.centering * 0.2 + sub.corners * 0.25 + sub.edges * 0.25 + sub.surface * 0.3;
  const lowest = Math.min(sub.centering, sub.corners, sub.edges, sub.surface);
  return Math.max(1, Math.min(10, Math.floor(avg + 0.35), Math.floor(lowest + 0.5)));
}

export function gradeCard(
  cardId: string,
  foil: boolean,
  random: () => number = Math.random,
  taken: ReadonlySet<string> = new Set(),
): Slab {
  const lr = cut(random);
  const tb = cut(random);
  const sub: Subgrades = {
    centering: centeringGrade(lr, tb),
    corners: pick(WEAR, random()),
    edges: pick(WEAR, random()),
    surface: pick(foil ? FOIL_SURFACE : WEAR, random()),
  };
  let cert = '';
  do cert = String(10000000 + Math.floor(random() * 90000000)); while (taken.has(cert));
  const grade = overall(sub);
  return {
    cert, cardId, foil, sub, lr, tb, grade,
    pristine: SUBGRADES.every((k) => sub[k] === 10),
    gradedAt: Date.now(),
  };
}
