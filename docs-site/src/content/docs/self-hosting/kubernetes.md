---
title: Kubernetes
description: Helm-based install for teams with an existing cluster.
---

## When to use Kubernetes

- You already run other workloads on k8s and want Workforce0 on the
  same plane.
- You need horizontal scaling of the backend beyond what Docker Compose
  gives you.
- You want cloud-managed Postgres / Redis and to keep only the app
  tier in-cluster.

Otherwise, Docker Compose is simpler.

## Helm chart

```bash
helm repo add workforce0 https://charts.workforce0.dev
helm repo update

helm install workforce0 workforce0/workforce0 \
  -n workforce0 --create-namespace \
  -f my-values.yaml
```

## Minimal `my-values.yaml`

```yaml
image:
  repository: ghcr.io/workforce0/workforce0
  tag: latest

env:
  JWT_SECRET: <32+ chars>

secrets:
  anthropicApiKey: ""      # set at least one provider
  openaiApiKey: ""
  geminiApiKey: ""

postgres:
  enabled: true            # deploy bitnami chart sub-dep; set false to use external
  auth:
    password: <generate>

redis:
  enabled: true

ingress:
  enabled: true
  host: workforce0.example.com
  tls:
    enabled: true
    secretName: workforce0-tls
```

## Common customisations

### External Postgres / Redis

```yaml
postgres:
  enabled: false
redis:
  enabled: false
env:
  DATABASE_URL: postgresql://user:pass@pg.internal:5432/workforce0?sslmode=require
  REDIS_URL: rediss://default:pass@redis.internal:6380
```

### Multiple backend replicas

```yaml
backend:
  replicas: 3
  resources:
    requests:
      cpu: 500m
      memory: 1Gi
    limits:
      cpu: 2
      memory: 2Gi

# Exactly one replica must own the cron scheduler role:
backend:
  extraEnv:
    WORKFORCE0_CRON_ENABLED_REPLICA_INDEX: "0"
```

### Agent daemon out-of-cluster

Usually you do **not** want to run the agent daemon in cluster — it
needs access to the operator's local Claude Code / Cursor CLI
subscription, which typically lives on a developer laptop. Set:

```yaml
agent:
  enabled: false
```

And run `npm run agent:dev` on the operator's machine, pointing its
`API_URL` at the cluster's ingress.

## Networking

- **Backend** — ClusterIP service on port 3000, ingress `/api/*`.
- **Frontend** — ClusterIP on port 3001, ingress `/`.
- **Postgres / Redis** — ClusterIP only (never exposed).
- **Agent daemon (if in-cluster)** — no service; connects out to
  backend.

## Secrets

All provider API keys pass through a Kubernetes `Secret`. The chart
mounts them as env vars. Rotate via `kubectl create secret` →
rolling restart of the deployment.

## Storage

- **Postgres** — 20 GB RWX PVC by default. Bump via
  `postgres.persistence.size`.
- **Redis** — 1 GB RWX PVC (AOF persistence). Usually enough.
- **Uploads** — 5 GB RWX PVC shared across backend replicas.

Use a CSI driver that supports RWX (cephfs, EFS, Filestore) for the
uploads PVC, or configure `UPLOADS_BACKEND=s3` and point at cloud
object storage.

## Observability

The chart can bolt on:

- **ServiceMonitor** for Prometheus — `metrics.enabled: true`.
- **PodLogs** sidecar for Loki — `logging.loki.enabled: true`.

Detailed metrics list: [Observability](/self-hosting/observability/).

## Upgrades

```bash
helm repo update
helm upgrade workforce0 workforce0/workforce0 -n workforce0 -f my-values.yaml
```

Migrations run via an init-container on backend start. For breaking
schema changes the upgrade path is documented in the changelog —
check before bumping a major.

## Uninstall

```bash
helm uninstall workforce0 -n workforce0
kubectl delete pvc -n workforce0 --all   # drops data — back up first
```

## Gotchas

- **Probes too strict on cold start.** Default `initialDelaySeconds`
  is 30s; first-ever boot can take 90s on small nodes because Prisma
  migrations haven't been baked into the image yet. Bump both
  liveness and readiness if you see `CrashLoopBackOff` on install.
- **DATABASE_URL and `?sslmode=require`.** Managed Postgres (RDS,
  Cloud SQL) usually requires `sslmode=require` — set it explicitly.
  Prisma's default is permissive but fails silently in ways that
  take 30 minutes to diagnose.
- **BullMQ cluster mode.** Redis Cluster is NOT supported — BullMQ
  requires single-shard Redis. Use Redis Sentinel or managed Redis
  in single-shard mode.
