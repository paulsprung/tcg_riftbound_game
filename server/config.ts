/**
 * Server settings, all from the environment (see .env.example). Secrets
 * never live in the code or the repo.
 */
export interface Config {
  port: number;
  /** Where the site is reached from outside, e.g. https://rift.shyy.dev */
  publicUrl: string;
  databaseUrl: string;
  discordClientId: string;
  discordClientSecret: string;
  /** Folder with the built app (vite build). */
  staticDir: string;
  /** Where a visitor's address comes from: behind Cloudflare (TRUST_PROXY=true) its CF-Connecting-IP
      header, behind a reverse proxy of your own (TRUST_PROXY=forwarded) the last X-Forwarded-For entry,
      which that proxy adds; otherwise the connection itself. */
  trustProxy: boolean | 'forwarded';
  /** Who runs the site, for the legal notice and the privacy notice: a name, the town (no street:
      § 25 (5) of the Austrian Media Act asks no more of a small private site) and an e-mail. */
  operator: { name: string; place: string; email: string; hosting: string } | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`Missing environment variable ${k} (see .env.example)`);
    return v;
  };
  return {
    port: Number(env.PORT ?? 8080),
    publicUrl: need('PUBLIC_URL').replace(/\/$/, ''),
    databaseUrl: need('DATABASE_URL'),
    discordClientId: need('DISCORD_CLIENT_ID'),
    discordClientSecret: need('DISCORD_CLIENT_SECRET'),
    staticDir: env.STATIC_DIR ?? 'dist',
    // only behind a proxy that sets the header (Cloudflare): otherwise anyone could pick their address
    trustProxy: env.TRUST_PROXY === 'forwarded' ? 'forwarded' : env.TRUST_PROXY === 'true',
    operator: env.OPERATOR_NAME ? {
      name: env.OPERATOR_NAME, place: env.OPERATOR_PLACE ?? '', email: env.OPERATOR_EMAIL ?? '', hosting: env.OPERATOR_HOSTING ?? '',
    } : null,
  };
}
