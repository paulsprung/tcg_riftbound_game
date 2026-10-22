# Deployment auf Hetzner (rift.shyy.dev)

App, Postgres und ein Cloudflare Tunnel laufen per Docker Compose auf einem
Server. Der Tunnel verbindet sich von innen zu Cloudflare, also müssen keine
Ports offen sein und es braucht keine Zertifikate auf dem Server.

## Einmalig

1. **Discord-App** (https://discord.com/developers/applications → New Application)
   - OAuth2 → Redirects: `https://rift.shyy.dev/auth/discord/callback`
   - Client ID und Client Secret notieren (gehören nur in `.env`).
2. **Cloudflare Tunnel** (Zero Trust → Networks → Tunnels → Create, Typ Cloudflared)
   - Token kopieren.
   - Public Hostname: `rift.shyy.dev` → Service `http://app:8080`.
   - Den DNS-Eintrag legt Cloudflare dabei selbst an.
3. **Server** (Docker und das Compose-Plugin installiert):
   ```bash
   git clone https://github.com/paulsprung/tcg_riftbound_game.git rift && cd rift
   cp .env.example .env && nano .env   # alles ausfüllen
   docker compose up -d --build
   curl -s 127.0.0.1:8080/api/health   # {"ok":true}
   ```

## Update

```bash
cd rift && git pull && docker compose up -d --build
```

Datenbank-Änderungen (`server/migrations/*.sql`) laufen beim Start von selbst.

## Backup

```bash
docker compose exec db pg_dump -U rift rift | gzip > rift-$(date +%F).sql.gz
```

## Lokal ausprobieren

```bash
docker compose up -d db          # oder eine eigene Postgres
npm run build && npm run build:server
PUBLIC_URL=http://localhost:8080 DATABASE_URL=postgres://... \
DISCORD_CLIENT_ID=... DISCORD_CLIENT_SECRET=... npm start
```

Discord braucht dafür zusätzlich `http://localhost:8080/auth/discord/callback`
als Redirect. Die Server-Tests laufen mit `TEST_DATABASE_URL=postgres://... npm test`
gegen eine leere Datenbank.
