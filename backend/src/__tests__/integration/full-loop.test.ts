/**
 * Full-loop integration test.
 *
 * Exercises the end-to-end path the user described:
 *   meeting captured → transcript → BA → PRD → approved → Architect
 *   → design → Dev reads PRD with design attached
 *
 * Uses in-memory mocks for Prisma + Redis + model calls (no network).
 * The goal is to prove the wiring between services is correct, not to
 * benchmark model quality — model output quality is a separate
 * concern.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LiveCaptureService } from '../../services/meeting/live-capture.service.js';
import { ArchitectService } from '../../services/agent/architect.service.js';
import { createDevTools } from '../../services/agents/dev/tools.js';

// ─── Minimal Redis mock ────────────────────────────────────────────────────
function makeRedis() {
  const kv = new Map<string, { value: string; expires: number }>();
  const lists = new Map<string, string[]>();
  return {
    kv,
    lists,
    async setex(key: string, ttl: number, value: string) {
      kv.set(key, { value, expires: Date.now() + ttl * 1000 });
      return 'OK';
    },
    async get(key: string) {
      const entry = kv.get(key);
      if (!entry || entry.expires < Date.now()) return null;
      return entry.value;
    },
    async del(key: string) {
      const existed = kv.delete(key) || lists.delete(key);
      return existed ? 1 : 0;
    },
    async rpush(key: string, value: string) {
      const list = lists.get(key) ?? [];
      list.push(value);
      lists.set(key, list);
      return list.length;
    },
    async lrange(key: string, start: number, end: number) {
      const list = lists.get(key) ?? [];
      const normEnd = end === -1 ? list.length : end + 1;
      return list.slice(start, normEnd);
    },
    async llen(key: string) {
      return (lists.get(key) ?? []).length;
    },
    async expire() {
      return 1;
    },
  };
}

// ─── Minimal Prisma mock ───────────────────────────────────────────────────
function makePrisma() {
  const meetings = new Map<string, any>();
  const transcripts = new Map<string, any>();
  const prds = new Map<string, any>();
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;
  return {
    meetings,
    transcripts,
    prds,
    meeting: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: nextId('meeting'), ...data, createdAt: new Date(), updatedAt: new Date() };
        meetings.set(row.id, row);
        return row;
      }),
    },
    transcript: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: nextId('transcript'), ...data, createdAt: new Date() };
        transcripts.set(row.id, row);
        return row;
      }),
    },
    pRD: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: nextId('prd'), ...data, createdAt: new Date(), updatedAt: new Date() };
        prds.set(row.id, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where, select }: any) => {
        const row = prds.get(where.id);
        if (!row) return null;
        if (select) {
          const out: Record<string, unknown> = {};
          for (const k of Object.keys(select)) out[k] = row[k];
          return out;
        }
        return row;
      }),
      findFirst: vi.fn(async ({ where, select }: any) => {
        const row = prds.get(where.id);
        if (!row) return null;
        if (where.tenantId !== undefined && row.tenantId !== where.tenantId) return null;
        if (select) {
          const out: Record<string, unknown> = {};
          for (const k of Object.keys(select)) out[k] = row[k];
          return out;
        }
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = prds.get(where.id);
        Object.assign(row, data);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = prds.get(where.id);
        if (!row) return { count: 0 };
        if (where.tenantId !== undefined && row.tenantId !== where.tenantId) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
  };
}

// ─── Fake queue that captures enqueued jobs ────────────────────────────────
function makeQueue() {
  const enqueued: Array<{ type: string; data: any }> = [];
  return {
    enqueued,
    async addJob(type: any, data: any) {
      enqueued.push({ type, data });
      return `job-${enqueued.length}`;
    },
  };
}

describe('Full loop: live capture → brief → approve → design → Dev', () => {
  let redis: ReturnType<typeof makeRedis>;
  let prisma: ReturnType<typeof makePrisma>;
  let queue: ReturnType<typeof makeQueue>;

  beforeEach(() => {
    redis = makeRedis();
    prisma = makePrisma();
    queue = makeQueue();
  });

  it('captures a meeting, generates a PRD, designs it, and Dev reads the design', async () => {
    // ── 1. Live capture: start → chunks → end ──────────────────────────────
    const captureService = new LiveCaptureService(prisma as any, redis as any, queue as any);
    const session = await captureService.start({
      tenantId: 'tenant-1',
      userId: 'user-1',
      title: 'Q3 Planning',
    });
    expect(session.status).toBe('streaming');

    await captureService.appendChunk(session.id, {
      text: 'We need to ship the new approval queue by end of month.',
      speaker: 'Priya',
      at: new Date().toISOString(),
    });
    await captureService.appendChunk(session.id, {
      text: 'David will take the backend work.',
      speaker: 'David',
      at: new Date().toISOString(),
    });

    expect(await captureService.chunkCount(session.id)).toBe(2);

    const ended = await captureService.end(session.id);
    expect(ended.transcriptLength).toBeGreaterThan(0);

    // Meeting + Transcript were created
    expect(prisma.meeting.create).toHaveBeenCalledTimes(1);
    expect(prisma.transcript.create).toHaveBeenCalledTimes(1);
    // BA job was enqueued
    expect(queue.enqueued).toHaveLength(1);
    expect(queue.enqueued[0]!.type).toBe('ba_agent_process');
    expect(queue.enqueued[0]!.data.meetingId).toBe(ended.meetingId);

    // ── 2. Simulate BA producing a PRD (stubbed — real BA uses Gemini) ─────
    // In production, BAAgentService.processMeetingTranscript creates this row.
    // We shortcut it here to keep the test hermetic.
    const approvedPrd = await prisma.pRD.create({
      data: {
        taskId: 'task-1',
        meetingId: ended.meetingId,
        tenantId: 'tenant-1',
        title: 'Approval Queue v1',
        summary: 'Two-pane inbox for product leaders to triage AI-generated work.',
        objectives: ['Support keyboard navigation', 'Batch-approve safe items'],
        requirements: [{ title: 'Two-pane layout', description: 'List + detail' }],
        acceptanceCriteria: ['Reviewer clears 10 items in under 2 min'],
        outOfScope: [],
        assumptions: [],
        risks: [],
        architectureOptions: [],
        confidence: 0.9,
        status: 'approved',
      },
    });

    // ── 3. Architect runs on the approved PRD ──────────────────────────────
    const gemini = {
      generateFreeformText: vi.fn(async () =>
        JSON.stringify({
          summary: 'Server-rendered Next.js page with SSE live updates.',
          components: [
            { name: 'ApprovalsPage', responsibility: 'Renders queue UI', dependencies: ['ApiClient'] },
            { name: 'ApprovalService', responsibility: 'Applies decisions', dependencies: [] },
          ],
          apis: [
            { kind: 'http', name: 'GET /api/approvals', description: 'list queue', output: '{items}' },
            { kind: 'http', name: 'POST /api/approvals/:id/approve', description: 'approve one' },
          ],
          dataModel: [
            { name: 'approval_items', fields: [{ name: 'id', type: 'uuid', nullable: false }] },
          ],
          risks: [],
          implementationOrder: ['Schema', 'API handlers', 'UI'],
        }),
      ),
    };
    const architect = new ArchitectService(prisma as any, gemini as any);
    const design = await architect.designFromPrd(approvedPrd.id, 'tenant-1');
    expect(design.components.length).toBe(2);
    expect(design.apis[0]!.name).toContain('/api/approvals');

    // PRD now has the design attached
    const withDesign = await prisma.pRD.findUnique({
      where: { id: approvedPrd.id },
      select: { architectureDesign: true },
    });
    expect(withDesign?.architectureDesign).toBeTruthy();

    // ── 4. Dev's read_prd tool surfaces the design ─────────────────────────
    const devTools = createDevTools({
      prisma: prisma as any,
      memoryService: null,
      githubService: null,
      geminiService: null,
    } as any);
    const readPrd = devTools.find((t) => t.name === 'read_prd')!;
    const readResult = await readPrd.execute(
      {},
      {
        tenantId: 'tenant-1',
        engagementId: 'eng-1',
        agentType: 'dev',
        traceId: 'trace-1',
        memory: { prdId: approvedPrd.id },
      },
    );

    expect(readResult.success).toBe(true);
    const payload = readResult.data as any;
    expect(payload.title).toBe('Approval Queue v1');
    // Architect's design flows through to the Dev agent's tool output
    expect(payload.architectureDesign).toBeTruthy();
    expect(payload.architectureDesign.components).toHaveLength(2);
    expect(payload.architectureDesign.apis[0].name).toContain('/api/approvals');
  });
});
