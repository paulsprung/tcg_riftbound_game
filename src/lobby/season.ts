/*
 * The picture on Home for the current season: one image, drifting slowly.
 * Until a real one is supplied (drop a file into public/ and put its path in
 * `art`), the season's legend card art stands in for it.
 */
export const SEASON = {
  name: 'Radiance',
  legend: 'Seraphine, Starry-Eyed Songstress',
  /** e.g. '/season/hero.webp'. null: use the legend's card art. */
  art: null as string | null,
};
