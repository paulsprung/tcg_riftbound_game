/*
 * The lobby shows things that need the server (rank, level, friends, match
 * stats). Without it there is nothing real to show. The preview build fills
 * them with sample values so the pages read as designed; everywhere else
 * they stay greyed out as "coming soon".
 */
export const DEMO = Boolean(import.meta.env.VITE_PREVIEW);

export const DEMO_PROFILE = {
  name: 'Riftwalker',
  rank: 'Diamond III',
  rp: 1847,
  rpPct: 72,
  level: 47,
  joined: 'Season 1',
  matches: 1247,
  winRate: '68.4%',
  tournaments: 12,
};

export const DEMO_FRIENDS = [
  { name: 'Kaisa_Main', state: 'online' },
  { name: 'VoidWalker', state: 'online' },
  { name: 'Ahri_Fox', state: 'away' },
  { name: 'Tahm_Kench', state: 'offline' },
] as const;
