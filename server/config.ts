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
  /** Behind Cloudflare (TRUST_PROXY=true, set in docker-compose.yml): trust its CF-Connecting-IP header. */
  trustProxy: boolean;
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
    trustProxy: env.TRUST_PROXY === 'true',
  };
}
