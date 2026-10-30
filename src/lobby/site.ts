import { useSyncExternalStore } from 'react';
import { DEMO } from './demo.ts';
import { NEWS } from './news.ts';
import { SEASON } from './season.ts';

/*
 * What Home shows, as the admins set it (server/site.ts, read at /api/home):
 * the news and the banner. Without a server (the preview, playing offline)
 * the words written into the app stand in.
 */

export type Tone = 'purple' | 'green' | 'gold' | 'teal' | 'red';
export interface NewsItem { id: string; tag: string; tone: Tone; title: string; body: string; published?: boolean }
export interface HomeBanner { legend: string; season: string; kicker: string; headline: string; text: string; button: string; link: string }
export interface Home { news: NewsItem[]; banner: HomeBanner }

export const TONES: Tone[] = ['purple', 'green', 'gold', 'teal', 'red'];
export const DEFAULT_BANNER: HomeBanner = { legend: SEASON.legend, season: SEASON.name, kicker: '', headline: '', text: '', button: '', link: '' };
const OFFLINE: Home = { news: NEWS.map((n) => ({ ...n, id: n.title })), banner: DEFAULT_BANNER };

let home: Home = OFFLINE;
let asked = false;
const subs = new Set<() => void>();

function load() {
  if (DEMO) return;
  fetch('/api/home').then((r) => (r.ok ? r.json() : null))
    .then((d: { news: NewsItem[]; home: HomeBanner | null } | null) => {
      if (!d) return;
      home = { news: d.news, banner: { ...DEFAULT_BANNER, ...(d.home ?? {}), legend: d.home?.legend || DEFAULT_BANNER.legend } };
      subs.forEach((f) => f());
    })
    .catch(() => undefined);
}

/** Read again (after an admin changed it). */
export function reloadHome() { load(); }

export function useHome(): Home {
  if (!asked) { asked = true; load(); }
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => home);
}
