# Database Migrations

This directory contains every schema change Workforce0 has ever shipped. If you self-host, this is the folder that keeps your Postgres in sync with the code you just pulled.

Don't worry — migrations are designed to be boring. This README explains what happens under the hood and how to get out of trouble if something goes sideways.

---

## Overview

Workforce0 uses [Prisma Migrate](https://www.prisma.io/docs/concepts/components/prisma-migrate) to evolve the Postgres schema over time. Each migration lives in its own folder:

```
YYYYMMDDHHMMSS_short_description/
  └── migration.sql
```

The timestamp prefix enforces ordering — Prisma applies migrations in timestamp order, tracks what's been applied in a `_prisma_migrations` table, and skips anything it has already run.

**On backend boot**, the container runs:

```bash
npx prisma migrate deploy
```

This is the production-safe command: it **only applies pending migrations** and never generates new SQL or drops data. We never use `prisma db push` in production — that command bypasses migration history and can cause drift.

If `migrate deploy` fails, the backend process exits. You'll see your container in a restart loop until you intervene (see [Rollback scenarios](#rollback-scenarios) below).

---

## Before every upgrade: take a backup

This is the single most important thing you can do. It takes ~30 seconds and saves hours of panic.

```bash
docker exec workforce0-postgres pg_dump -U postgres workforce0 \
  | gzip > ~/workforce0-backup-$(date +%F).sql.gz
```

Verify the file exists and isn't empty before proceeding:

```bash
ls -lh ~/workforce0-backup-*.sql.gz
```

For automated daily backups, see the cron snippet in [`docs/self-hosting.md`](../../../docs/self-hosting.md#backups).

---

## Upgrading (the normal path)

Most upgrades are a three-command affair:

```bash
cd workforce0
git pull
docker compose -f docker-compose.prod.yml up -d
```

Migrations run automatically when the backend container starts. To watch them apply:

```bash
docker compose -f docker-compose.prod.yml logs backend | grep -i migrate
```

You should see something like:

```
Applying migration `20260312103000_add_agent_tokens`
The following migration(s) have been applied: 1
```

If the backend comes up healthy (`docker compose ps` shows `healthy`), you're done.

**If the backend keeps restarting**, `migrate deploy` is failing. Jump to [Rollback scenarios](#rollback-scenarios).

---

## Reading migration names

Migration folders follow this format:

```
20260318094512_add_webhook_endpoints/
│             │
│             └── short snake_case description of what changed
└─ UTC timestamp (year, month, day, hour, minute, second)
```

The description is for humans — the timestamp is what Prisma uses. Never rename or reorder existing migration folders after they've been applied to a production database.

---

## Manual migration (advanced)

If you need to run migrations outside of the normal boot path — for example, while debugging a stuck container — you can invoke Prisma directly:

```bash
docker exec workforce0-backend npx prisma migrate deploy
```

To see what's pending without applying:

```bash
docker exec workforce0-backend npx prisma migrate status
```

This is the same command the backend runs on startup, just from your shell.

---

## Rollback scenarios

### "I upgraded and it broke"

The safe recovery: go back to the previous code, then restore the database from backup.

```bash
# 1. Stop services
docker compose -f docker-compose.prod.yml down

# 2. Check out the previous tag
git fetch --tags
git checkout <previous-tag>      # e.g. git checkout v1.4.2

# 3. Restore the database
gunzip -c ~/workforce0-backup-YYYY-MM-DD.sql.gz \
  | docker exec -i workforce0-postgres psql -U postgres workforce0

# 4. Bring it back up
docker compose -f docker-compose.prod.yml up -d
```

### "Migrate failed halfway through"

Prisma wraps each migration in a transaction where possible, so partial application is rare. If it does happen, `migrate status` will show the failed migration as `rolled back`. Restore from backup (step 3 above) and file an issue with the log output.

### "I need to roll back a single migration"

Prisma doesn't support automatic down-migrations. The supported path is always: restore the DB from the backup taken **before** the upgrade. This is why the backup step is non-negotiable.

---

## Breaking changes

Workforce0 follows [semver](https://semver.org). Inside a major version (v1.x → v1.y), migrations are always additive and safe to apply in-place.

**Major version bumps (v1 → v2, v2 → v3) may require manual steps** — data backfills, config changes, or sequenced restarts. Before any major upgrade:

1. Read [`CHANGELOG.md`](../../../CHANGELOG.md) for the target version.
2. Look for a **Migration notes** section.
3. Run the backup command above.
4. Follow the version-specific instructions.

If the changelog doesn't mention anything special, the normal upgrade path works.

---

## Fresh install

A brand new deployment needs no special handling. On first boot against an empty database, `prisma migrate deploy` runs every migration in order and leaves you at the current schema. The same command handles a DB with 50 migrations and a DB with 0 — just let it run.

---

## Custom migrations (for forks)

If you fork Workforce0 and add your own models or columns, generate migrations with:

```bash
cd mvp
npx prisma migrate dev --name your_change_description
```

This creates a new `YYYYMMDDHHMMSS_your_change_description/migration.sql` file. Commit it alongside the `schema.prisma` edit.

Options from here:

- **Keep it in your fork** — perfectly fine, just remember to rebase on upstream carefully to avoid timestamp collisions.
- **Upstream it** — open a PR. If it's generally useful, we'd love to include it.

**Never edit an existing migration file** after it has been applied to any database (yours or anyone else's). Always add a new migration that alters what the previous one created.

---

## Known-safe migration sequence (nuclear reset)

If your database is in a genuinely unrecoverable state — migrations half-applied, schema drift, `_prisma_migrations` table corrupted — and you have no production data to preserve, you can wipe and rebuild:

```bash
# WARNING: This deletes all data. Restore from backup afterward if needed.
docker compose -f docker-compose.prod.yml down -v postgres
docker compose -f docker-compose.prod.yml up -d
```

The `-v` flag drops the Postgres volume. On the next boot, `migrate deploy` runs all migrations against a fresh DB. If you have a backup, restore it *after* the migrations have all applied successfully.

---

## Getting help

Migrations are the component most likely to leave you stuck in a weird state. We'd rather help you recover than have you struggle silently.

- **GitHub Discussions:** https://github.com/workforce0/workforce0/discussions — best for "is this expected?" questions
- **Issue tracker:** https://github.com/workforce0/workforce0/issues — if you hit a reproducible bug in a migration

Include the output of these when asking for help:

```bash
docker exec workforce0-backend npx prisma migrate status
docker compose -f docker-compose.prod.yml logs backend --tail=200
```

Your backup is your safety net. Take one before every upgrade and you'll never have a truly bad day with this system.
