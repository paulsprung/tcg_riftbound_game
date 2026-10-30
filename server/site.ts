import type { Db } from './db.ts';
import { Refused } from './economy.ts';

/*
 * What admins set on Home (the admin page's Home & news): the news column,
 * in their order, and the banner's words (the season's legend, a kicker, a
 * headline, a line under it and a button). Everyone reads it at /api/home.
 */

export const TONES = ['purple', 'green', 'gold', 'teal', 'red'] as const;

export interface News { id: string; tag: string; tone: (typeof TONES)[number]; title: string; body: string; published: boolean }
export interface HomeBanner {
  /** The legend whose art fills the banner (its card name), and the season's name. */
  legend: string; season: string;
  /** Words over the art; empty ones are left out. */
  kicker: string; headline: string; text: string;
  /** A button: its label and where it goes in the app ('#shop', '#play'…). */
  button: string; link: string;
}

const text = (v: unknown, max: number, what: string, need = false) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length > max) throw new Refused(`${what}: ${max} characters at most`);
  if (need && !s) throw new Refused(`${what} is missing`);
  return s;
};

function newsInput(b: Record<string, unknown>) {
  const tone = TONES.includes(b.tone as never) ? (b.tone as News['tone']) : null;
  if (!tone) throw new Refused('Pick a colour');
  return {
    tag: text(b.tag, 20, 'The tag', true), tone, title: text(b.title, 80, 'The title', true),
    body: text(b.body, 400, 'The text', true), published: b.published !== false,
  };
}

const row = (r: Record<string, unknown>): News => ({
  id: String(r.id), tag: String(r.tag), tone: r.tone as News['tone'], title: String(r.title), body: String(r.body), published: !!r.published,
});

export const site = {
  async news(db: Db, all = false): Promise<News[]> {
    const r = await db.query(`SELECT * FROM site_news ${all ? '' : 'WHERE published'} ORDER BY position, created_at DESC`);
    return r.rows.map(row);
  },

  /** A new item goes on top; an id edits that one. */
  async saveNews(db: Db, actor: string, b: Record<string, unknown>): Promise<News> {
    const n = newsInput(b);
    if (typeof b.id === 'string' && b.id) {
      const r = await db.query(`UPDATE site_news SET tag = $2, tone = $3, title = $4, body = $5, published = $6, updated_by = $7 WHERE id::text = $1 RETURNING *`,
        [b.id, n.tag, n.tone, n.title, n.body, n.published, actor]);
      if (!r.rowCount) throw new Refused('No such news', 404);
      return row(r.rows[0]);
    }
    const r = await db.query(`INSERT INTO site_news (tag, tone, title, body, published, position, updated_by)
      VALUES ($1, $2, $3, $4, $5, coalesce((SELECT min(position) FROM site_news), 1) - 1, $6) RETURNING *`,
    [n.tag, n.tone, n.title, n.body, n.published, actor]);
    return row(r.rows[0]);
  },

  async deleteNews(db: Db, id: string) {
    await db.query('DELETE FROM site_news WHERE id::text = $1', [id]);
  },

  /** The news in this order (ids not given keep their place after them). */
  async orderNews(db: Db, ids: unknown) {
    if (!Array.isArray(ids) || ids.length > 200 || !ids.every((x) => typeof x === 'string')) throw new Refused('Which order?');
    await db.query('UPDATE site_news n SET position = o.i FROM unnest($1::text[]) WITH ORDINALITY AS o(id, i) WHERE n.id::text = o.id', [ids]);
  },

  async home(db: Db): Promise<HomeBanner | null> {
    const r = await db.query("SELECT value FROM site_settings WHERE key = 'home'");
    return (r.rows[0]?.value as HomeBanner | undefined) ?? null;
  },

  async setHome(db: Db, actor: string, b: Record<string, unknown>): Promise<HomeBanner> {
    const link = text(b.link, 60, 'The link');
    if (link && !/^#[a-z0-9/_-]*$/.test(link)) throw new Refused('The link is a place in the app, like #shop');
    const v: HomeBanner = {
      legend: text(b.legend, 80, 'The legend'), season: text(b.season, 40, 'The season'),
      kicker: text(b.kicker, 40, 'The kicker'), headline: text(b.headline, 80, 'The headline'), text: text(b.text, 200, 'The text'),
      button: text(b.button, 30, 'The button'), link,
    };
    await db.query(`INSERT INTO site_settings (key, value, updated_by) VALUES ('home', $1, $2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`, [JSON.stringify(v), actor]);
    return v;
  },
};
