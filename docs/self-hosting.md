# Self-hosting Workforce0

For running Workforce0 on your own server, in production, for a real team.

If you just want to try it locally, use the [quickstart](./quickstart.md) instead.

---

## Reference architecture

```
       ┌─────────────────┐
       │  Cloudflare /   │  HTTPS termination, DDoS protection
       │     Caddy       │  (or Traefik / Nginx)
       └────────┬────────┘
                │
       ┌────────▼────────┐
       │  Frontend       │  Next.js — port 3001
       │  (Next.js)      │
       └────────┬────────┘
                │
       ┌────────▼────────┐
       │  Backend API    │  Fastify — port 3000
       │  (Fastify)      │
       └──┬──────────┬───┘
          │          │
    ┌─────▼──┐   ┌───▼────┐
    │Postgres│   │ Redis  │
    └────────┘   └────────┘
```

Minimum specs: 2 vCPU, 4 GB RAM, 20 GB disk.
Comfortable specs: 4 vCPU, 8 GB RAM, 50 GB disk.

## Deployment checklist

- [ ] DNS: A/AAAA record pointing to your server
- [ ] HTTPS: Caddy, Traefik, or Cloudflare Tunnel in front of the frontend
- [ ] `.env`: every REQUIRED variable set, secrets rotated from defaults
- [ ] Backups: automated Postgres dumps (see below)
- [ ] Monitoring: at minimum, an uptime check on `/health`
- [ ] Log shipping: Pino logs → your aggregator (Datadog, Loki, CloudWatch, etc.)
- [ ] Rate limiting: `RATE_LIMIT_MAX` set appropriately for your team size
- [ ] CORS: `CORS_ORIGINS` locked down to your actual frontend URL

## HTTPS with Caddy (simplest)

Caddy auto-provisions Let's Encrypt certs.

`Caddyfile`:
```caddy
workforce0.yourcompany.com {
    reverse_proxy localhost:3001
}

api.workforce0.yourcompany.com {
    reverse_proxy localhost:3000
}
```

Run:
```bash
docker run -d --name caddy \
  -p 80:80 -p 443:443 \
  -v $PWD/Caddyfile:/etc/caddy/Caddyfile \
  -v caddy_data:/data \
  caddy:2
```

## Backups

### Automated Postgres dump (cron)

```bash
# /etc/cron.daily/workforce0-backup
#!/bin/bash
set -e
BACKUP_DIR=/var/backups/workforce0
mkdir -p "$BACKUP_DIR"
docker exec workforce0-postgres pg_dump -U postgres workforce0 \
  | gzip > "$BACKUP_DIR/workforce0-$(date +%F).sql.gz"
find "$BACKUP_DIR" -name 'workforce0-*.sql.gz' -mtime +30 -delete
```

### Restore

```bash
gunzip -c workforce0-2026-04-18.sql.gz \
  | docker exec -i workforce0-postgres psql -U postgres workforce0
```

### Off-site

Rsync, `rclone`, or `restic` the `/var/backups/workforce0/` directory to S3 / Backblaze / your NAS.

## Upgrades

Workforce0 follows [semver](https://semver.org). Upgrade procedure:

```bash
cd workforce0
git fetch --tags
git checkout <latest-tag>
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Migrations run automatically on backend boot. Check `CHANGELOG.md` before major version bumps.

**Before upgrading:** take a backup.

## Hardening

- **Non-root containers:** All images already run as `appuser:1001`.
- **Read-only root filesystem:** Add `read_only: true` to services in `docker-compose.prod.yml` (test first).
- **Secret rotation:** Rotate `JWT_SECRET` and `POSTGRES_PASSWORD` every 90 days.
- **Admin UI behind VPN:** For private teams, expose only via Tailscale / WireGuard — skip public internet entirely.
- **Fail2ban:** Add if you expose SSH to the internet.

## Custom domain

Same process on any platform:

1. Add an A record pointing your domain to the server IP (or CNAME to your platform).
2. Update `PUBLIC_URL` in `.env` to `https://your-domain.com`.
3. Update `CORS_ORIGINS` to the same URL.
4. Restart: `docker compose -f docker-compose.prod.yml up -d`.
5. Verify HTTPS works and the UI loads.

## Monitoring

**Bare minimum:** UptimeRobot or Healthchecks.io pinging `https://your-domain.com/health` every 5 minutes.

**Recommended:**
- Logs: `docker logs` → Vector / Fluent Bit → Loki / Datadog
- Metrics: Prometheus scraping `/metrics` (when enabled)
- Errors: Sentry DSN in `.env` (set `SENTRY_DSN=...`)

## Recovery scenarios

| Scenario | Recovery |
|---|---|
| Server dies | Restore from backup to new server, restore `.env`, `docker compose up -d` |
| Forgot admin password | `docker exec workforce0-backend node scripts/reset-admin-password.js <email>` |
| Bad migration | Roll back with `git checkout <prev-tag>`, restore DB backup, re-up |
| AI provider down | Council falls back automatically; check `Settings → AI providers` status |

## Sizing guide

| Team size | Meetings/day | Recommended specs |
|---|---|---|
| 1–5 | < 10 | 2 vCPU, 4 GB, $10–20/mo |
| 5–25 | 10–50 | 4 vCPU, 8 GB, $40/mo |
| 25–100 | 50–200 | 8 vCPU, 16 GB, $80/mo, add read replica |
| 100+ | 200+ | HA setup — separate DB / cache / app tiers |

## Going further

- [**BYOK guide**](./byok.md) — add more AI models
- [**Contributing**](../CONTRIBUTING.md) — customize the code for your team
- [**Security policy**](../SECURITY.md) — report vulnerabilities privately
