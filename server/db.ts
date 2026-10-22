import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export type Db = pg.Pool;

export function connect(url: string): Db {
  return new pg.Pool({ connectionString: url, max: 10 });
}

const here = dirname(fileURLToPath(import.meta.url));

/** Applies the .sql files in migrations/ that have not run yet, in name
    order, each in its own transaction. */
export async function migrate(db: Db, dir = process.env.MIGRATIONS_DIR ?? join(here, 'migrations')): Promise<string[]> {
  await db.query('CREATE TABLE IF NOT EXISTS migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM migrations')).rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(join(dir, f), 'utf8');
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO migrations (name) VALUES ($1)', [f]);
      await c.query('COMMIT');
      applied.push(f);
    } catch (err) {
      await c.query('ROLLBACK');
      throw new Error(`migration ${f} failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      c.release();
    }
  }
  return applied;
}
