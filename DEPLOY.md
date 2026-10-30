# Hosting mit Docker

App, Postgres und (optional) ein Cloudflare Tunnel laufen per Docker Compose
auf einem Server. Datenbank-Migrationen laufen beim Start von selbst.

Es gibt zwei Wege ins Internet:

- **Variante A: Cloudflare Tunnel** (Standard). Der Tunnel verbindet sich von
  innen zu Cloudflare. Es müssen keine Ports offen sein und auf dem Server
  braucht es keine Zertifikate.
- **Variante B: eigener Reverse Proxy** (Nginx, Caddy, Traefik, Nginx Proxy
  Manager …). Der Proxy macht HTTPS und leitet an die App weiter.

Getestet: das Image baut, `app` und `db` starten, die Migrationen laufen,
`/api/health` antwortet.

## Was du brauchst

- Einen Server mit Docker und dem Compose-Plugin (`docker compose version`).
  4 GB RAM reichen (siehe `docs/CAPACITY.md`).
- Eine Domain, im Folgenden `rift.example.de`.
- Einen Discord-Account für die Login-App.

## 1. Discord-App anlegen

1. Öffne https://discord.com/developers/applications und klicke auf
   **New Application**.
2. Trage unter **OAuth2 → Redirects** diese Adresse ein:
   `https://rift.example.de/auth/discord/callback`
3. Kopiere **Client ID** und **Client Secret**. Sie kommen nur in die `.env`
   auf dem Server, nie ins Repo und nie in einen Chat.

## 2. Code holen und `.env` füllen

```bash
git clone https://github.com/paulsprung/tcg_riftbound_game.git rift && cd rift
cp .env.example .env
chmod 600 .env
nano .env
```

| Eintrag | Inhalt |
|---|---|
| `PUBLIC_URL` | `https://rift.example.de` (ohne `/` am Ende, genau so wie im Browser) |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | aus Schritt 1 |
| `POSTGRES_PASSWORD` | langes Zufallspasswort: `openssl rand -hex 24` |
| `TUNNEL_TOKEN` | nur Variante A (Schritt 3A) |
| `APP_PORT` | Port auf dem Server, Standard `8080` |
| `OPERATOR_NAME`, `OPERATOR_ADDRESS`, `OPERATOR_EMAIL` | dein Impressum (Pflicht in DE, § 5 DDG). Adresszeilen mit `\|` trennen, z. B. `Musterstr. 1\|12345 Musterstadt\|Germany` |
| `TRUST_PROXY`, `APP_BIND` | nur Variante B (Schritt 3B) |

`.env` ist in `.gitignore` und `.dockerignore`. Sie landet also weder im Repo
noch im Image.

## 3A. Cloudflare Tunnel

1. Lege in Cloudflare Zero Trust unter **Networks → Tunnels** einen Tunnel an
   (**Create**, Typ Cloudflared).
2. Kopiere den Token in `.env` als `TUNNEL_TOKEN`.
3. Lege unter **Public Hostname** den Eintrag `rift.example.de` an, mit
   Service `http://app:8080`. Den DNS-Eintrag setzt Cloudflare dabei selbst.
4. Starte alles:

   ```bash
   docker compose up -d --build
   ```

## 3B. Eigener Reverse Proxy (ohne Cloudflare)

1. Ergänze die `.env`:

   ```
   TRUST_PROXY=forwarded
   APP_BIND=127.0.0.1
   ```

   - `TRUST_PROXY=forwarded` sorgt dafür, dass die Rate-Limits die echte
     Besucher-IP sehen. Die App nimmt dafür den letzten Eintrag von
     `X-Forwarded-For`.
   - `APP_BIND=127.0.0.1` passt, wenn der Proxy direkt auf dem Server läuft.
   - Läuft der Proxy selbst in einem Docker-Container, setze
     `APP_BIND=0.0.0.0`. Sperre den Port dann mit einer Firewall nach außen
     (z. B. `ufw deny 8080`). Den Proxy richtest du auf
     `http://<Server-IP>:8080`.
2. Starte nur App und Datenbank, ohne den Tunnel:

   ```bash
   docker compose up -d --build app db
   ```

3. Konfiguriere den Proxy. Er muss Websockets durchlassen (Pfad `/ws`) und
   `X-Forwarded-For` setzen.

   **Caddy** (holt das Zertifikat selbst):

   ```
   rift.example.de {
       reverse_proxy 127.0.0.1:8080
   }
   ```

   **Nginx:**

   ```nginx
   server {
       listen 443 ssl http2;
       server_name rift.example.de;
       # ssl_certificate … (z. B. certbot)
       location / {
           proxy_pass http://127.0.0.1:8080;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_read_timeout 3600s;
       }
   }
   ```

   Im **Nginx Proxy Manager** reicht ein Proxy Host auf `<Server-IP>:8080`
   mit eingeschalteter Option „Websockets Support“ und einem SSL-Zertifikat.

Die Seite muss über HTTPS laufen: das Login-Cookie ist dann `Secure`, und
Discord verlangt die exakte Redirect-Adresse.

## 4. Prüfen

```bash
docker compose ps                    # app und db "healthy"
curl -s 127.0.0.1:8080/api/health    # {"ok":true,...}
curl -s 127.0.0.1:8080/api/site      # dein Impressum
docker compose logs -f app           # "migrations applied …", "Riftbound server on :8080"
```

Rufe danach `https://rift.example.de` auf und melde dich mit Discord an.

## 5. Dich zum Admin machen

Melde dich einmal mit Discord an. Danach brauchst du deine Discord-ID: in
Discord **Einstellungen → Erweitert → Entwicklermodus** einschalten, dann
Rechtsklick auf dich → **User-ID kopieren**. Damit:

```bash
docker compose exec db psql -U rift rift -c "UPDATE users SET is_admin = true WHERE discord_id = 'DEINE_ID'"
```

Die Ausgabe muss `UPDATE 1` sein. Lade die Seite neu; oben rechts erscheint
der Link „Admin“ (`#admin`):

- **Players:** Spieler suchen (Name oder Discord-ID) und Coins oder Packs
  vergeben, immer mit Grund. Jede Vergabe steht mit Admin und Grund im
  `ledger`.
- **Tournaments:** Turniere anlegen:
  - Constructed, Sealed oder Draft (mit Set, Bauzeit und Pick-Uhr)
  - Bo1 oder Bo3, Spielerzahl, Startgebühr
  - Top Cut, Swiss-Runden, Preise

  Ein Turnier startet zur Startzeit von selbst. Bei einer Absage gehen die
  Startgebühren zurück.

## Update

```bash
cd rift && git pull && docker compose up -d --build          # Variante A
cd rift && git pull && docker compose up -d --build app db   # Variante B
```

Laufende Spiele überstehen einen Neustart: Sie werden aus `live_games`
wiederhergestellt, und wer nicht innerhalb von drei Minuten zurück ist,
verliert. Nur wenn sich Engine oder Kartendaten geändert haben, werden laufende
Spiele verworfen. Spiele also am besten Updates ein, wenn wenig los ist.

## Backup und Wiederherstellen

```bash
# Backup (z. B. täglich per cron)
docker compose exec -T db pg_dump -U rift rift | gzip > rift-$(date +%F).sql.gz

# Wiederherstellen in eine leere Datenbank
docker compose down && docker volume rm rift_pgdata   # Achtung: löscht die DB
docker compose up -d db
gunzip -c rift-2026-10-30.sql.gz | docker compose exec -T db psql -U rift rift
docker compose up -d
```

Der Volume-Name ist `<Ordnername>_pgdata`; nachsehen mit `docker volume ls`.

## Sicherheit, kurz

- Nach außen offen sind nur der Tunnel oder dein Proxy:
  - Postgres hat keinen Port nach außen.
  - Die App lauscht nur auf `127.0.0.1`, außer du setzt `APP_BIND` anders.
- Die App läuft im Container als Benutzer `node`, nicht als root.
- Secrets stehen nur in `.env` (mit `chmod 600`).
- Wird das Discord-Secret geleakt, setze es im Developer Portal neu und trage
  es in `.env` ein. Danach `docker compose up -d`.
- Optional: Pinne das Tunnel-Image auf eine feste Version, statt `latest` zu
  nehmen (`image: cloudflare/cloudflared:<version>` in `docker-compose.yml`).

## Lokal ausprobieren (ohne Docker)

```bash
docker compose up -d db          # oder eine eigene Postgres
npm run build && npm run build:server
PUBLIC_URL=http://localhost:8080 DATABASE_URL=postgres://... \
DISCORD_CLIENT_ID=... DISCORD_CLIENT_SECRET=... npm start
```

Discord braucht dafür zusätzlich `http://localhost:8080/auth/discord/callback`
als Redirect. Die Server-Tests laufen gegen eine leere Datenbank:

```bash
TEST_DATABASE_URL=postgres://... npm test
```
