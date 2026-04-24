---
title: Backups & restore
description: What to back up, how often, and how to actually restore. Including the drill.
---

## What to back up

Three things matter:

1. **Postgres database** — all meetings, transcripts, briefs, plans,
   tickets, users, audit logs, approval history. Source of truth.
2. **`.env` file** — secrets. Can be regenerated but keeping a copy
   saves time on restore.
3. **Uploads volume** — meeting audio files (if `RETAIN_RECORDINGS=1`).
   Optional; transcripts survive without them.

Redis is ephemeral; don't back it up. A lost Redis means in-flight
queue jobs get re-enqueued from Postgres.

## Backing up Postgres

### Nightly, via cron

```bash
# /etc/cron.d/workforce0-backup
0 3 * * * root /usr/local/bin/backup-workforce0.sh
```

`backup-workforce0.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR=/var/backups/workforce0
RETENTION_DAYS=14
STAMP=$(date +%F-%H%M)

mkdir -p "$BACKUP_DIR"

docker compose -f /opt/workforce0/docker-compose.prod.yml exec -T postgres \
  pg_dump -Fc -U postgres workforce0 > "$BACKUP_DIR/wf0-$STAMP.dump"

# Prune old backups
find "$BACKUP_DIR" -name "wf0-*.dump" -mtime +$RETENTION_DAYS -delete
```

### Off-host copy

Nightly backups on the same disk don't protect against disk failure.
Also ship to object storage:

```bash
# Append to the script
aws s3 cp "$BACKUP_DIR/wf0-$STAMP.dump" s3://my-backups/workforce0/
```

Or rclone, or scp to a different host. Anywhere not-this-disk.

### Encrypted backups

Treat Postgres dumps as secret material — they include encrypted
credentials that a disclosed `JWT_SECRET` would unlock.

```bash
gpg --symmetric --cipher-algo AES256 -o wf0-$STAMP.dump.gpg wf0-$STAMP.dump
```

Store the passphrase in a password manager, NOT in the backup path.

## Backup frequency — what to actually run

| Deployment size           | Cadence          | Retention |
| ------------------------- | ---------------- | --------- |
| Hobby / personal use      | Weekly           | 4 weeks   |
| Small team (<10 execs)    | Nightly          | 14 days   |
| Medium team               | Nightly + hourly WAL | 30 days |
| Critical / regulated      | Continuous WAL   | per policy |

**Continuous WAL archiving** (pgBackRest / wal-g) gets point-in-time
recovery — the gold standard. Overkill for most.

## Restore

### Full restore (disaster recovery)

1. Provision a fresh host with Docker + docker-compose.
2. Clone the repo at the same version tag as the backup.
3. Copy your `.env` over (or regenerate; keys in the DB are encrypted
   with the same `JWT_SECRET`, so it MUST match).
4. Start only Postgres:
   ```bash
   docker compose -f docker-compose.prod.yml up -d postgres
   ```
5. Restore:
   ```bash
   cat wf0-YYYY-MM-DD.dump | docker compose -f docker-compose.prod.yml \
     exec -T postgres pg_restore -U postgres -d workforce0 --clean --if-exists
   ```
6. Start everything else:
   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

Total elapsed time for a 2 GB dump: ~8 minutes.

### Single-project restore (selective)

If you want to restore just one project (e.g. an exec accidentally
deleted it):

```bash
pg_restore --list wf0-YYYY-MM-DD.dump > manifest
# Edit manifest to keep only the rows referencing the target project
pg_restore -L manifest -d workforce0 wf0-YYYY-MM-DD.dump
```

This is fragile (foreign keys), but doable for focused rollbacks.

## The restore drill

:::caution
Untested backups aren't backups. They're **attempted** backups.
:::

Quarterly:

1. Spin up a scratch VM (or local Docker).
2. Run the full-restore procedure against the latest backup.
3. Log in, confirm at least 5 meetings and their briefs load.
4. Destroy the scratch VM.

Write down how long it took. That's your real RTO.

## What Postgres features to use

- **`pg_dump -Fc` (custom format).** Smaller, parallelizable,
  selective restore-able.
- **`--clean --if-exists`.** Safe against partial restores.
- **Postgres ≥ 16.** Older versions work but we don't test them.

## DB-layer replication

For "can't afford 8 minutes of downtime" scenarios:

- **Streaming replication** to a warm standby (built-in Postgres).
- **Logical replication** to a separate DB if you want to keep the
  standby on a different major version.
- **Managed Postgres** (Neon, Supabase, RDS) — they do this for you.

## Restoring uploads

If you kept `RETAIN_RECORDINGS=1` and backed up the uploads volume:

```bash
rsync -av /var/backups/workforce0-uploads/ /var/lib/workforce0/uploads/
```

If you didn't: the transcripts in Postgres are enough to continue
operating. Historical audio is just gone.

## Redis

```bash
# Back up if you really want to (queue-state only, ephemeral)
docker compose -f docker-compose.prod.yml exec redis redis-cli BGSAVE
# Then copy /data/dump.rdb
```

Usually unnecessary — a cold restart repopulates the queue from the
DB's `AgentJob` rows.

## Off-site DR in 30 minutes

```
Backup: encrypted dump nightly, pushed to S3 in another region.
Recovery: fresh Docker host in the DR region + your `.env` + the
dump. Follow "Full restore" above. Total elapsed: ~20 minutes +
DNS propagation.
```

That's enough for most teams. If you need faster, use streaming
replication or a managed Postgres with multi-AZ failover.
