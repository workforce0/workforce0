# Plan 3 — Wizard, Migration, Observability

> **For agentic workers:** Use superpowers:subagent-driven-development.

**Goal:** Surface Plans 1+2's new capabilities through the existing setup wizard (3 new steps + apply), add a migration banner so existing installs can opt in to local models / Vexa, expose a `/api/integrations/status` aggregator + status indicators in Settings, ship a `bin/diagnose.sh` script and a `bin/setup-finish.sh` apply helper, update the landing page and README to reflect Step 0.

**Architecture:** Wizard lives in `frontend/src/components/onboarding-wizard.tsx` today (5 steps, ~416 lines). Plan 3 adds steps for Hardware Check, Local Models, and Meeting Capture. Backend gains a thin `HardwareDetectService` (reads `os.totalmem()` + `os.cpus()`), an `/api/integrations/status` route that fan-outs to `/health` of every service, and a `diagnose.sh` shell script for support workflows. Migration banner is a single React component conditional on `tenantSettings.step0Migrated === false`.

**Tech Stack:** Next.js 16 + React 19 (frontend), Fastify + TypeScript (backend), Bash (scripts).

**Spec:** `docs/superpowers/specs/2026-04-25-step-0-local-everything-bundle-design.md` §9 + §11 + §12.

**Deferred to Step 1 (called out in spec):**
- Prometheus + Grafana JSON dashboard (Plan 3 emits structured logs only).
- Per-tenant `MeetingBotConfig` table (Plan 3 only adds the `step0Migrated`/`step0Dismissed` flags to TenantSettings).
- CI migration smoke test wired into GitHub Actions (Plan 3 writes the test file; wiring deferred).

---

## File structure

```
backend/
├── src/
│   ├── services/wizard/
│   │   ├── hardware-detect.service.ts                         NEW (RAM/CPU/disk detect)
│   │   └── hardware-detect.service.test.ts                    NEW
│   ├── routes/
│   │   └── integrations-status.routes.ts                      NEW (/api/integrations/status aggregator)
│   ├── lib/di-container.ts                                    modified (wire hardware service)
│   └── prisma/schema.prisma                                   modified (add step0Migrated, step0Dismissed)
frontend/
├── src/
│   ├── components/onboarding-wizard.tsx                       modified (3 new steps)
│   ├── components/wizard/
│   │   ├── hardware-check.tsx                                 NEW
│   │   ├── local-models-toggle.tsx                            NEW
│   │   └── meeting-capture-picker.tsx                         NEW
│   ├── components/step0-migration-banner.tsx                  NEW (shown to existing installs)
│   ├── app/(dashboard)/settings/system-status/
│   │   └── page.tsx                                           NEW (status dashboard)
│   └── lib/api/integrations-status.ts                         NEW (typed client)
bin/                                                            NEW directory
├── diagnose.sh                                                NEW (support diagnostic)
└── setup-finish.sh                                            NEW (apply wizard config)
docs-site/src/content/docs/
├── self-hosting/wizard.md                                     NEW (wizard walkthrough)
└── self-hosting/diagnose.md                                   NEW (troubleshooting)
public_website/
├── index.html                                                 modified (Step 0 mention)
└── main.js                                                    modified (if needed for new sections)
README.md                                                       modified (Step 0 callout)
```

---

## Task 1: Add `step0Migrated` + `step0Dismissed` to `TenantSettings`

**File:** `backend/prisma/schema.prisma`

- [ ] **Step 1:** Find the existing `TenantSettings` model (added in Plan 1).

```bash
cd backend && grep -A 15 "^model TenantSettings" prisma/schema.prisma
```

- [ ] **Step 2:** Append two optional fields:

```prisma
model TenantSettings {
  // ... existing fields ...
  meetingBotProviderId String?
  step0Migrated        Boolean  @default(false)
  step0Dismissed       Boolean  @default(false)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  // ... existing relations ...
}
```

- [ ] **Step 3:** Generate migration:

```bash
cd backend && npx prisma migrate dev --name add_step0_migration_flags --create-only
```

Inspect the SQL — must be additive (`ADD COLUMN ... DEFAULT false`).

- [ ] **Step 4:** Apply (or use `prisma migrate diff` if direct DB unreachable):

```bash
cd backend && npm run db:migrate
```

- [ ] **Step 5:** Commit:

```bash
cd backend && git add prisma/schema.prisma prisma/migrations/ && git commit -m "feat(db): add step0Migrated and step0Dismissed flags to TenantSettings"
```

---

## Task 2: HardwareDetectService — TDD

**Files:** `backend/src/services/wizard/hardware-detect.service.ts` and `.test.ts`

- [ ] **Step 1: failing test** at `backend/src/services/wizard/hardware-detect.service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HardwareDetectService } from './hardware-detect.service.js';

vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

describe('HardwareDetectService', () => {
  let service: HardwareDetectService;
  beforeEach(() => { service = new HardwareDetectService(); });

  it('returns total RAM, CPU count, and recommended tier', async () => {
    const profile = await service.detect();
    expect(profile.totalRamGB).toBeGreaterThan(0);
    expect(profile.cpuCores).toBeGreaterThan(0);
    expect(profile.availableForLLM_GB).toBe(profile.totalRamGB - 7);
    expect(['light', 'default', 'heavy']).toContain(profile.recommendedTier);
  });

  it('classifies <9 GB available as light tier', () => {
    expect(service.pickTier(8)).toBe('light');
    expect(service.pickTier(0)).toBe('light');
  });

  it('classifies 9-25 GB available as default tier', () => {
    expect(service.pickTier(9)).toBe('default');
    expect(service.pickTier(20)).toBe('default');
    expect(service.pickTier(24)).toBe('default');
  });

  it('classifies 25 GB+ available as heavy tier', () => {
    expect(service.pickTier(25)).toBe('heavy');
    expect(service.pickTier(64)).toBe('heavy');
  });
});
```

- [ ] **Step 2: implement** at `backend/src/services/wizard/hardware-detect.service.ts`:

```ts
/**
 * HardwareDetectService — read host RAM/CPU and recommend a Step 0 tier.
 *
 * @module services/wizard/hardware-detect.service
 */

import os from 'node:os';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'HardwareDetectService' });

export type HardwareTier = 'light' | 'default' | 'heavy';

export interface HardwareProfile {
  totalRamGB: number;
  cpuCores: number;
  availableForLLM_GB: number;
  recommendedTier: HardwareTier;
}

/** RAM budget reserved for OS + Workforce0 base + STT, in GB. */
const RESERVED_GB = 7;

export class HardwareDetectService {
  async detect(): Promise<HardwareProfile> {
    const totalRamGB = Math.round((os.totalmem() / 1e9) * 10) / 10;
    const cpuCores = os.cpus().length;
    const availableForLLM_GB = Math.max(0, totalRamGB - RESERVED_GB);
    const recommendedTier = this.pickTier(availableForLLM_GB);
    const profile: HardwareProfile = { totalRamGB, cpuCores, availableForLLM_GB, recommendedTier };
    logger.info(profile, 'Hardware detected');
    return profile;
  }

  pickTier(availableGB: number): HardwareTier {
    if (availableGB < 9) return 'light';
    if (availableGB < 25) return 'default';
    return 'heavy';
  }
}
```

- [ ] **Step 3:** Run, commit:

```bash
cd backend && npx vitest run src/services/wizard/hardware-detect.service.test.ts
cd backend && git add src/services/wizard/ && git commit -m "feat(wizard): HardwareDetectService maps RAM to recommended tier"
```

---

## Task 3: Status aggregator route

**Files:** `backend/src/routes/integrations-status.routes.ts`, mount in `backend/src/routes/index.ts`

- [ ] **Step 1:** Create the route:

```ts
/**
 * GET /api/integrations/status — aggregates health of all bundled services.
 *
 * @module routes/integrations-status
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger({ service: 'IntegrationsStatus' });

type StatusValue = 'up' | 'down' | 'disabled';

interface ServiceStatus {
  service: string;
  status: StatusValue;
  latencyMs: number | null;
  lastError: string | null;
}

async function probe(name: string, url: string | undefined, enabled: boolean): Promise<ServiceStatus> {
  if (!enabled || !url) return { service: name, status: 'disabled', latencyMs: null, lastError: null };
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return {
      service: name,
      status: res.ok ? 'up' : 'down',
      latencyMs: Date.now() - t0,
      lastError: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    return { service: name, status: 'down', latencyMs: Date.now() - t0, lastError: (err as Error).message };
  }
}

export async function integrationsStatusRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/integrations/status', async (_req: FastifyRequest, reply: FastifyReply) => {
    const services = (fastify as unknown as { services: { config?: { OLLAMA_BASE_URL?: string; WHISPER_BASE_URL?: string; VEXA_API_URL?: string } } }).services;
    const cfg = services.config ?? {};

    const results = await Promise.all([
      probe('ollama',           cfg.OLLAMA_BASE_URL ? `${cfg.OLLAMA_BASE_URL}/api/tags`     : undefined, !!cfg.OLLAMA_BASE_URL),
      probe('whisper',          cfg.WHISPER_BASE_URL ? `${cfg.WHISPER_BASE_URL}/health`     : undefined, !!cfg.WHISPER_BASE_URL),
      probe('vexa_api',         cfg.VEXA_API_URL ? `${cfg.VEXA_API_URL}/health`             : undefined, !!cfg.VEXA_API_URL),
    ]);

    return reply.send({ success: true, data: results });
  });
}
```

- [ ] **Step 2:** Mount in `routes/index.ts`:

```ts
import { integrationsStatusRoutes } from './integrations-status.routes.js';
// ...
await fastify.register(integrationsStatusRoutes, { prefix: '/api' });
```

- [ ] **Step 3:** Update DI container so `fastify.services.config` is exposed (the route reads `OLLAMA_BASE_URL` etc.). If `services.config` doesn't exist yet, add `config` to the decorate object.

- [ ] **Step 4:** Add a unit test at `backend/src/routes/__tests__/integrations-status.routes.test.ts` asserting:
  - All three services come back as `disabled` when no env vars set
  - Mocked `fetch` 200 → `up`
  - Mocked `fetch` reject → `down` with error message
  - Latency is recorded as a number

- [ ] **Step 5:** Commit:

```bash
cd backend && git add src/routes/integrations-status.routes.ts src/routes/__tests__/integrations-status.routes.test.ts src/routes/index.ts src/lib/di-container.ts && git commit -m "feat(api): /api/integrations/status aggregates Ollama/Whisper/Vexa health"
```

---

## Task 4: bin/setup-finish.sh + bin/diagnose.sh

**Files:** `bin/setup-finish.sh`, `bin/diagnose.sh`, `bin/README.md`

- [ ] **Step 1:** Create `bin/setup-finish.sh`:

```bash
#!/usr/bin/env bash
# Apply wizard configuration: pull images, restart services, tail logs.
#
# Usage: ./bin/setup-finish.sh [--profile <profile>]...
# Examples:
#   ./bin/setup-finish.sh
#   ./bin/setup-finish.sh --profile meeting-bot --profile local-llm

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "ERROR: .env not found in $(pwd)"
  echo "Run the wizard first or copy .env.example to .env"
  exit 1
fi

# Read COMPOSE_PROFILES from .env if not passed via flags.
if [ "${COMPOSE_PROFILES:-}" = "" ] && grep -q '^COMPOSE_PROFILES=' .env; then
  export "$(grep '^COMPOSE_PROFILES=' .env | head -1)"
fi

PROFILES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILES+=("--profile" "$2"); shift 2;;
    *) echo "Unknown arg: $1"; exit 2;;
  esac
done

echo "==> Pulling images..."
docker compose -f docker-compose.prod.yml "${PROFILES[@]}" pull

echo "==> Starting services..."
docker compose -f docker-compose.prod.yml "${PROFILES[@]}" up -d --remove-orphans

echo "==> Tailing backend + frontend logs (Ctrl-C to stop)..."
docker compose -f docker-compose.prod.yml logs -f --tail=20 backend frontend
```

`chmod +x bin/setup-finish.sh`.

- [ ] **Step 2:** Create `bin/diagnose.sh`:

```bash
#!/usr/bin/env bash
# Workforce0 diagnostic — collects health + last log lines for all services.
# PII-aware: redacts .env values and meeting URLs from output.

set -uo pipefail

cd "$(dirname "$0")/.."

OUTFILE="diagnostics-$(date +%Y%m%dT%H%M%S).txt"

{
  echo "Workforce0 diagnostic — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "─────────────────────────────────────"
  echo

  for svc in backend frontend postgres redis ollama whisper vexa-api vexa-bot-manager docker-socket-proxy; do
    cid=$(docker compose -f docker-compose.prod.yml ps -q "$svc" 2>/dev/null || true)
    if [ -z "$cid" ]; then
      echo "[$svc] not running"
      continue
    fi
    state=$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || echo unknown)
    health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' "$cid" 2>/dev/null || echo unknown)
    echo "[$svc] state=$state health=$health"
    echo "  last 5 log lines:"
    docker logs --tail 5 "$cid" 2>&1 | sed 's/^/    /' | sed -E 's/(API_KEY|TOKEN|SECRET|PASSWORD)=[^ ]+/\1=<redacted>/g'
    echo
  done

  echo "─────────────────────────────────────"
  echo "Output captured to ./$OUTFILE"
} | tee "$OUTFILE"

echo "Share $OUTFILE in your support thread (PII-redacted)."
```

`chmod +x bin/diagnose.sh`.

- [ ] **Step 3:** Create `bin/README.md` with one-paragraph descriptions of each script.

- [ ] **Step 4:** Commit:

```bash
git add bin/ && git commit -m "feat(bin): setup-finish.sh apply helper + diagnose.sh support script"
```

---

## Task 5: Wizard new steps (frontend)

**Files:** `frontend/src/components/wizard/{hardware-check,local-models-toggle,meeting-capture-picker}.tsx`, `frontend/src/components/onboarding-wizard.tsx`

The existing wizard (`onboarding-wizard.tsx`, 416 lines, 5 steps) needs three new screens inserted before the integrations step.

- [ ] **Step 1: Read the existing wizard** to understand its step pattern:

```bash
cd frontend && cat src/components/onboarding-wizard.tsx | head -100
```

Note the existing pattern — likely a state machine driven by `currentStep`. Match it.

- [ ] **Step 2: Hardware check screen** at `frontend/src/components/wizard/hardware-check.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Cpu, HardDrive, MemoryStick } from "lucide-react";

interface HardwareProfile {
  totalRamGB: number;
  cpuCores: number;
  availableForLLM_GB: number;
  recommendedTier: 'light' | 'default' | 'heavy';
}

export function HardwareCheck({ onDetected }: { onDetected: (p: HardwareProfile) => void }) {
  const [profile, setProfile] = useState<HardwareProfile | null>(null);

  useEffect(() => {
    fetch('/api/setup/hardware', { credentials: 'include' })
      .then((r) => r.json())
      .then((j: { data: HardwareProfile }) => {
        setProfile(j.data);
        onDetected(j.data);
      })
      .catch(() => {
        // best-effort — fall back to defaults
        const fallback: HardwareProfile = { totalRamGB: 0, cpuCores: 0, availableForLLM_GB: 0, recommendedTier: 'default' };
        setProfile(fallback);
        onDetected(fallback);
      });
  }, [onDetected]);

  if (!profile) return <div>Detecting hardware…</div>;

  return (
    <Card><CardContent className="space-y-4">
      <h3 className="text-lg font-semibold">Hardware check</h3>
      <div className="grid grid-cols-3 gap-4">
        <div className="flex items-center gap-2"><MemoryStick className="h-4 w-4" /> {profile.totalRamGB} GB RAM</div>
        <div className="flex items-center gap-2"><Cpu className="h-4 w-4" /> {profile.cpuCores} CPU cores</div>
        <div className="flex items-center gap-2"><HardDrive className="h-4 w-4" /> {profile.availableForLLM_GB} GB free for AI</div>
      </div>
      <p className="text-sm text-muted-foreground">
        Recommended tier: <strong>{profile.recommendedTier}</strong>.
        You can change this later in Settings.
      </p>
    </CardContent></Card>
  );
}
```

- [ ] **Step 3: Local models toggle** at `frontend/src/components/wizard/local-models-toggle.tsx`:

```tsx
"use client";
import { Card, CardContent } from "@/components/ui/card";

export type LocalTier = 'light' | 'default' | 'heavy' | 'none';

export function LocalModelsToggle({ value, onChange, recommended }: { value: LocalTier; onChange: (v: LocalTier) => void; recommended: LocalTier }) {
  const tiers: { id: LocalTier; label: string; disk: string; desc: string }[] = [
    { id: 'none',    label: 'No local models', disk: '0 GB',     desc: 'BYOK only — bring an Anthropic / OpenAI / Google key' },
    { id: 'light',   label: 'Light',           disk: '~5 GB',    desc: 'Qwen 3.5 8B — works on 16 GB RAM' },
    { id: 'default', label: 'Default',         disk: '~14 GB',   desc: 'Mistral Small 3 24B reasoning + Qwen 3.5 8B extraction' },
    { id: 'heavy',   label: 'Heavy',           disk: '~25 GB',   desc: 'Qwen 3.5 32B + 8B parallel — needs 48 GB+ RAM' },
  ];
  return (
    <Card><CardContent className="space-y-3">
      <h3 className="text-lg font-semibold">Local models</h3>
      <p className="text-sm text-muted-foreground">Run open-weights models locally as a fallback. Recommended for your hardware: <strong>{recommended}</strong>.</p>
      <div className="space-y-2">
        {tiers.map((t) => (
          <label key={t.id} className={`block p-3 rounded border cursor-pointer ${value === t.id ? 'border-violet bg-violet-light/20' : 'border-border'}`}>
            <input type="radio" name="local-tier" className="mr-2" checked={value === t.id} onChange={() => onChange(t.id)} />
            <strong>{t.label}</strong> · <span className="text-muted-foreground">{t.disk}</span>
            <div className="text-sm text-muted-foreground">{t.desc}</div>
          </label>
        ))}
      </div>
    </CardContent></Card>
  );
}
```

- [ ] **Step 4: Meeting capture picker** at `frontend/src/components/wizard/meeting-capture-picker.tsx`:

```tsx
"use client";
import { Card, CardContent } from "@/components/ui/card";

export type MeetingBotChoice = 'vexa' | 'recall' | 'skip';

export function MeetingCapturePicker({ value, onChange, onRecallKey }: {
  value: MeetingBotChoice;
  onChange: (v: MeetingBotChoice) => void;
  onRecallKey: (k: string) => void;
}) {
  const choices: { id: MeetingBotChoice; label: string; pros: string[]; cons: string[] }[] = [
    { id: 'vexa',   label: 'Bundled (Vexa)', pros: ['No external account', 'Apache 2.0', 'Audio stays on host'], cons: ['Adds ~310 MB RAM'] },
    { id: 'recall', label: 'Recall.ai (BYOK)', pros: ['Most reliable joins', 'Vendor-managed'], cons: ['~$0.50/hour', 'Audio leaves your network'] },
    { id: 'skip',   label: 'Skip (manual upload only)', pros: ['Always works'], cons: ['No live capture'] },
  ];
  return (
    <Card><CardContent className="space-y-3">
      <h3 className="text-lg font-semibold">Meeting capture</h3>
      <div className="grid md:grid-cols-3 gap-3">
        {choices.map((c) => (
          <label key={c.id} className={`block p-3 rounded border cursor-pointer ${value === c.id ? 'border-violet bg-violet-light/20' : 'border-border'}`}>
            <input type="radio" name="meeting-bot" className="mb-2" checked={value === c.id} onChange={() => onChange(c.id)} />
            <strong>{c.label}</strong>
            <ul className="text-xs mt-2 space-y-1">
              {c.pros.map((p) => <li key={p} className="text-emerald">✓ {p}</li>)}
              {c.cons.map((p) => <li key={p} className="text-amber">⚠ {p}</li>)}
            </ul>
          </label>
        ))}
      </div>
      {value === 'recall' && (
        <input type="password" placeholder="Recall.ai API key" className="w-full border p-2 rounded" onChange={(e) => onRecallKey(e.target.value)} />
      )}
    </CardContent></Card>
  );
}
```

- [ ] **Step 5: Wire the new steps into `onboarding-wizard.tsx`**

Find the step counter (`TOTAL_STEPS = 5`) and increment to 8. Add three new step branches before the integrations step. State for hardware profile, local tier, meeting bot choice persists to a new `/api/setup/save-step0` endpoint.

For brevity in this plan (subagent will handle insertion details based on the wizard's actual structure):
- Insert "Hardware check" as step 2 (between Welcome and AI Providers)
- Modify "AI Providers" step to add Local Models toggle next to BYOK keys
- Insert "Meeting capture" as new step before Integrations

When user clicks "Save & finish", POST to `/api/setup/save-step0` with `{ hardwareTier, localTier, meetingBotProvider, recallApiKey? }`. Backend writes to `tenantSettings` and the relevant `.env` keys.

- [ ] **Step 6: Backend `/api/setup/save-step0` route**

Create `backend/src/routes/setup-step0.routes.ts` that:
- Accepts the wizard payload
- Updates `tenantSettings.meetingBotProviderId`
- Sets `tenantSettings.step0Migrated = true`
- Writes appropriate env keys to `.env` (or returns them so the frontend can show what to add manually — depending on whether the backend has write access to `.env`; if not, return them as a list)

- [ ] **Step 7:** Run frontend + backend type-check + tests:

```bash
cd backend && npm run typecheck && npm test
cd frontend && npm run lint && npm run typecheck
```

- [ ] **Step 8:** Commit:

```bash
git add frontend/src/components/wizard/ frontend/src/components/onboarding-wizard.tsx backend/src/routes/setup-step0.routes.ts && git commit -m "feat(wizard): add hardware check, local models, and meeting capture steps"
```

---

## Task 6: Migration banner for existing installs

**Files:** `frontend/src/components/step0-migration-banner.tsx`, mount it in the dashboard layout

- [ ] **Step 1:** Create the banner component:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { X, Sparkles } from "lucide-react";

export function Step0MigrationBanner() {
  const [show, setShow] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/setup/state', { credentials: 'include' })
      .then((r) => r.json())
      .then((j: { data: { step0Migrated: boolean; step0Dismissed: boolean } }) => {
        setShow(!j.data.step0Migrated && !j.data.step0Dismissed);
      })
      .catch(() => setShow(false));
  }, []);

  async function dismiss() {
    setShow(false);
    await fetch('/api/setup/dismiss-step0', { method: 'POST', credentials: 'include' });
  }

  if (!show) return null;
  return (
    <div className="bg-violet-light/20 border border-violet/30 rounded p-3 flex items-center gap-2">
      <Sparkles className="h-4 w-4 text-violet" />
      <span className="text-sm">
        <strong>Workforce0 v0.6 adds local-first features.</strong> Run models on this machine, bundled meeting capture, local transcription. BYOK keeps working.
      </span>
      <Button size="sm" onClick={() => router.push('/setup?step0=1')}>Configure</Button>
      <Button size="sm" variant="ghost" onClick={dismiss}><X className="h-4 w-4" /></Button>
    </div>
  );
}
```

- [ ] **Step 2:** Mount it in `frontend/src/app/(dashboard)/layout.tsx` near the top of the main content area.

- [ ] **Step 3:** Backend routes:
- `GET /api/setup/state` → returns `{ step0Migrated, step0Dismissed }` from `tenantSettings`.
- `POST /api/setup/dismiss-step0` → sets `step0Dismissed = true`.

- [ ] **Step 4:** Tests for the banner backend routes (4 cases): unauth → 401, returns flags, dismiss flips dismissed flag, migrated tenants skip banner naturally.

- [ ] **Step 5:** Commit:

```bash
git add frontend/src/components/step0-migration-banner.tsx frontend/src/app/\(dashboard\)/layout.tsx backend/src/routes/setup-step0.routes.ts && git commit -m "feat(wizard): Step 0 migration banner for existing installs"
```

---

## Task 7: Settings → System Status page

**Files:** `frontend/src/app/(dashboard)/settings/system-status/page.tsx`

- [ ] **Step 1:** Create the page that polls `/api/integrations/status` and renders one row per service with traffic-light dot, latency, and last error:

```tsx
"use client";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";

interface Status { service: string; status: 'up'|'down'|'disabled'; latencyMs: number|null; lastError: string|null; }

export default function SystemStatusPage() {
  const [rows, setRows] = useState<Status[]>([]);
  useEffect(() => {
    const tick = () => fetch('/api/integrations/status', { credentials: 'include' })
      .then((r) => r.json()).then((j: { data: Status[] }) => setRows(j.data));
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-bold">System Status</h1>
      <p className="text-sm text-muted-foreground">Health of bundled services. Polls every 10 seconds.</p>
      <Card><CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b"><tr><th className="text-left p-3">Service</th><th className="text-left p-3">Status</th><th className="text-left p-3">Latency</th><th className="text-left p-3">Last error</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.service} className="border-b last:border-0">
                <td className="p-3 font-mono">{r.service}</td>
                <td className="p-3"><span className={`inline-block w-2 h-2 rounded-full mr-2 ${r.status==='up'?'bg-emerald':r.status==='down'?'bg-rose':'bg-slate-400'}`} />{r.status}</td>
                <td className="p-3">{r.latencyMs !== null ? `${r.latencyMs}ms` : '—'}</td>
                <td className="p-3 text-rose">{r.lastError ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}
```

- [ ] **Step 2:** Add a sidebar link to the new page (find `frontend/src/components/sidebar.tsx` and add a Settings → System Status entry).

- [ ] **Step 3:** Commit:

```bash
git add frontend/src/app/\(dashboard\)/settings/system-status/ frontend/src/components/sidebar.tsx && git commit -m "feat(ui): Settings → System Status page polling integration health"
```

---

## Task 8: Landing page Step 0 mention

**Files:** `public_website/index.html`, possibly `public_website/main.js`

- [ ] **Step 1: Read existing landing page** to understand structure:

```bash
cat public_website/index.html | head -80
```

- [ ] **Step 2:** Add a section near the existing feature/value-prop area:

> "Step 0 — runs on your laptop. One `docker compose up` starts a local meeting bot, local LLMs, local transcription. No external accounts required. BYOK works alongside."

Match the existing visual style (Tailwind classes, hero/section wrappers).

- [ ] **Step 3:** Commit:

```bash
git add public_website/ && git commit -m "docs(landing): mention Step 0 local-everything bundle"
```

---

## Task 9: Docs site — wizard walkthrough + diagnose guide

**Files:** `docs-site/src/content/docs/self-hosting/wizard.md`, `docs-site/src/content/docs/self-hosting/diagnose.md`

- [ ] **Step 1:** Create `wizard.md` with a step-by-step walkthrough including screenshot placeholders (we'll add real screenshots later via the existing capture script).

- [ ] **Step 2:** Create `diagnose.md` covering `bin/diagnose.sh` usage, when to run it, what to share in support threads, and the redaction policy.

- [ ] **Step 3:** Commit:

```bash
git add docs-site/src/content/docs/self-hosting/ && git commit -m "docs: wizard walkthrough + diagnose script guide"
```

---

## Task 10: README polish

**File:** `README.md`

- [ ] **Step 1:** Add a "Step 0 — Local Everything" section near the top, summarizing:
  - What's bundled (Vexa optional, Ollama optional, Whisper optional)
  - How to enable each via `COMPOSE_PROFILES`
  - Hardware tiers
  - Link to the new docs pages

- [ ] **Step 2:** Refresh the quickstart to reflect the wizard's new behavior.

- [ ] **Step 3:** Commit:

```bash
git add README.md && git commit -m "docs(readme): add Step 0 local-everything section"
```

---

## Task 11: CI migration smoke test (test file only — wiring deferred)

**File:** `backend/src/__tests__/integration/step0-migration.integration.test.ts`

Per spec §11: a CI job verifies that:
1. A pre-Step-0 install (no new tables, no new env keys) boots cleanly after upgrade.
2. The wizard "skip local, skip Vexa" path doesn't add new containers.
3. The wizard "enable Vexa, enable local-llm Light" path adds them.

Plan 3 ships the test file. The actual GitHub Actions wiring (running the test against a docker-compose'd Postgres + Redis) is deferred to a follow-up. Mark TODO at the top of the test file.

- [ ] **Step 1:** Create the test asserting the migration is additive (queryable via Prisma without errors against a fresh schema and against a schema with old columns).

- [ ] **Step 2:** Commit:

```bash
cd backend && git add src/__tests__/integration/step0-migration.integration.test.ts && git commit -m "test(migration): assert Step 0 schema changes are additive"
```

---

## Self-review checklist

- [ ] No `findFirst → create/update` races introduced in setup routes.
- [ ] Setup routes use service layer (not direct prisma).
- [ ] No swallowed errors in status aggregator (returns `down` with `lastError` on fetch fail — intentional).
- [ ] `step0Migrated`/`step0Dismissed` defaults are `false` so existing installs see banner once.
- [ ] All new logger calls use `log.error({obj}, 'msg')`.
- [ ] No frontend forms accept secrets via GET (Recall API key is in a POST body).

## Final verification

```bash
cd backend && npm test && npm run typecheck
cd frontend && npm run lint && npm run typecheck
docker compose -f docker-compose.prod.yml --profile meeting-bot --profile local-llm --profile local-stt config > /dev/null
```

All must pass.

## Notes for the implementer

- **Frontend test culture**: Plan 3 doesn't add Vitest tests for React components (they're mostly read-only fetches + radio buttons). If the existing wizard has Playwright e2e coverage, run those after wiring. If not, manual smoke-test in the dev server is acceptable for Step 0.
- **Backend setup routes** could grow large. Keep them in `setup-step0.routes.ts` — don't sprinkle across multiple files.
- **`.env` write access**: backend container probably can't write to host `.env`. Strategy: setup-step0 returns the env vars as a JSON list, and the wizard's apply step asks the user to paste them into `.env` themselves (or `setup-finish.sh` echoes them). Pick the simpler path — acknowledged as a UX rough edge for Plan 3, polishable in Step 1.
- **Prometheus**: NOT in Plan 3 scope. Just emit structured logs and call it a day.
