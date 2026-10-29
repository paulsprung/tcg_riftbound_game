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

export type Presence = 'online' | 'away' | 'offline';
export interface Friend { id: string; name: string; presence: Presence; doing: string; level: number }

export const DEMO_FRIENDS: Friend[] = [
  { id: 'kaisa', name: 'Kaisa_Main', presence: 'online', doing: 'In Lobby', level: 62 },
  { id: 'void', name: 'VoidWalker', presence: 'online', doing: 'In Game · Ranked', level: 48 },
  { id: 'jinx', name: 'Jinx_Boom', presence: 'online', doing: 'Browsing the Shop', level: 27 },
  { id: 'ahri', name: 'Ahri_Fox', presence: 'away', doing: 'Away', level: 33 },
  { id: 'tahm', name: 'Tahm_Kench', presence: 'offline', doing: 'Last seen 2 h ago', level: 51 },
  { id: 'lux', name: 'Lux_Light', presence: 'offline', doing: 'Last seen yesterday', level: 39 },
  { id: 'garen', name: 'Garen_Main', presence: 'offline', doing: 'Last seen 3 days ago', level: 18 },
];
