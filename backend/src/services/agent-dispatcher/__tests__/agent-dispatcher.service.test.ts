import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentDispatcherService } from '../agent-dispatcher.service.js';

function makePrisma(seed: {
  pRDs?: Array<Record<string, unknown>>;
  agentJobs?: Array<Record<string, unknown>>;
  meetings?: number;
  prdsTotal?: number;
  jobsTotal?: number;
} = {}) {
  return {
    pRD: {
      findMany: vi.fn().mockResolvedValue(seed.pRDs ?? []),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(seed.prdsTotal ?? 0),
    },
    agentJob: {
      findMany: vi.fn().mockResolvedValue(seed.agentJobs ?? []),
      count: vi.fn().mockImplementation(({ where }: { where: { status?: string } }) => {
        if (where?.status === 'done') return Promise.resolve(2);
        if (where?.status === 'failed') return Promise.resolve(0);
        return Promise.resolve(seed.jobsTotal ?? 0);
      }),
    },
    meeting: {
      count: vi.fn().mockResolvedValue(seed.meetings ?? 0),
    },
  };
}

describe('AgentDispatcherService.extractMention', () => {
  it('recognises every supported handle', () => {
    expect(AgentDispatcherService.extractMention('@ba status')).toBe('ba');
    expect(AgentDispatcherService.extractMention('@dev jobs')).toBe('dev');
    expect(AgentDispatcherService.extractMention('@qa')).toBe('qa');
    expect(AgentDispatcherService.extractMention('@architect abc123')).toBe('architect');
    expect(AgentDispatcherService.extractMention('@supervisor pipeline')).toBe('supervisor');
    expect(AgentDispatcherService.extractMention('@help')).toBe('help');
  });

  it('maps @workforce0 to help', () => {
    expect(AgentDispatcherService.extractMention('@workforce0 hi')).toBe('help');
  });

  it('is case-insensitive', () => {
    expect(AgentDispatcherService.extractMention('@BA status')).toBe('ba');
    expect(AgentDispatcherService.extractMention('@Dev jobs')).toBe('dev');
  });

  it('returns null when no mention present', () => {
    expect(AgentDispatcherService.extractMention('hello there')).toBeNull();
    expect(AgentDispatcherService.extractMention('APPROVE abc123')).toBeNull();
  });

  it('does not false-match on partial words', () => {
    expect(AgentDispatcherService.extractMention('@badminton')).toBeNull();
    expect(AgentDispatcherService.extractMention('@development')).toBeNull();
  });
});

describe('AgentDispatcherService.dispatch', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
  });

  it('returns handled=false when no mention', async () => {
    const svc = new AgentDispatcherService(prisma as any);
    const result = await svc.dispatch({
      text: 'hello',
      tenantId: 't-1',
      source: 'whatsapp',
    });
    expect(result).toEqual({ handled: false, agent: null, reply: '' });
  });

  describe('@help', () => {
    it('returns the quick-commands list', async () => {
      const svc = new AgentDispatcherService(prisma as any);
      const r = await svc.dispatch({ text: '@help', tenantId: 't-1', source: 'whatsapp' });
      expect(r.handled).toBe(true);
      expect(r.agent).toBe('help');
      expect(r.reply).toContain('Workforce0 quick commands');
      expect(r.reply).toContain('@ba status');
      expect(r.reply).toContain('APPROVE <token>');
    });
  });

  describe('@ba', () => {
    it('shows "nothing pending" with empty workspace', async () => {
      const svc = new AgentDispatcherService(prisma as any);
      const r = await svc.dispatch({ text: '@ba status', tenantId: 't-1', source: 'whatsapp' });
      expect(r.handled).toBe(true);
      expect(r.agent).toBe('ba');
      expect(r.reply).toContain('nothing pending');
    });

    it('lists pending briefs with short ids + confidence', async () => {
      prisma = makePrisma({
        pRDs: [
          {
            id: 'cmo-abcdef-xyz1234567',
            title: 'Q3 feature set',
            status: 'review',
            confidence: 0.87,
            createdAt: new Date(),
          },
          {
            id: 'cmo-ghijkl-zyx7654321',
            title: 'Partner portal redesign',
            status: 'pending_approval',
            confidence: 0.72,
            createdAt: new Date(),
          },
        ],
      });
      const svc = new AgentDispatcherService(prisma as any);
      const r = await svc.dispatch({ text: '@ba', tenantId: 't-1', source: 'whatsapp' });
      expect(r.reply).toContain('2 briefs pending');
      expect(r.reply).toContain('Q3 feature set');
      expect(r.reply).toContain('234567'); // last-6 of the first id
      expect(r.reply).toContain('87%');
    });

    it('asks for clarification on unrecognised BA intent', async () => {
      const svc = new AgentDispatcherService(prisma as any);
      const r = await svc.dispatch({
        text: '@ba build me a new widget',
        tenantId: 't-1',
        source: 'whatsapp',
      });
      expect(r.reply).toContain('I can show');
    });
  });

  describe('@dev', () => {
    it('handles empty job log', async () => {
      const svc = new AgentDispatcherService(prisma as any);
      const r = await svc.dispatch({ text: '@dev', tenantId: 't-1', source: 'whatsapp' });
      expect(r.reply).toContain('no recent code-gen jobs');
    });

    it('lists recent jobs', async () => {
      prisma = makePrisma({
        agentJobs: [
          { id: 'j-111222333', action: 'implement_prd', status: 'done', targetRepo: 'acme/web' },
          { id: 'j-444555666', action: 'review_pr', status: 'in_progress', targetRepo: 'acme/api' },
        ],
      });
      const svc = new AgentDispatcherService(prisma as any);
      const r = await svc.dispatch({ text: '@dev jobs', tenantId: 't-1', source: 'whatsapp' });
      expect(r.reply).toContain('last 2 jobs');
      expect(r.reply).toContain('implement_prd');
      expect(r.reply).toContain('acme/web');
    });
  });

  describe('@qa', () => {
    it('reports "no runs" when counts are zero', async () => {
      prisma = makePrisma();
      // Override count mock to return zeros for this test
      prisma.agentJob.count = vi.fn().mockResolvedValue(0);
      const svc = new AgentDispatcherService(prisma as any);
      const r = await svc.dispatch({ text: '@qa', tenantId: 't-1', source: 'whatsapp' });
      expect(r.reply).toContain('no review or test runs');
    });

    it('reports pass/fail counts', async () => {
      const svc = new AgentDispatcherService(prisma as any);
      const r = await svc.dispatch({ text: '@qa status', tenantId: 't-1', source: 'whatsapp' });
      expect(r.reply).toContain('2 passed');
      expect(r.reply).toContain('0 failed');
    });
  });

  describe('@architect', () => {
    it('prompts for an id when missing', async () => {
      const svc = new AgentDispatcherService(prisma as any);
      const r = await svc.dispatch({ text: '@architect', tenantId: 't-1', source: 'whatsapp' });
      expect(r.reply).toContain('tell me which brief');
    });

    it('reports "no match" for unknown id', async () => {
      prisma.pRD.findFirst = vi.fn().mockResolvedValue(null);
      const svc = new AgentDispatcherService(prisma as any);
      const r = await svc.dispatch({
        text: '@architect zzz999',
        tenantId: 't-1',
        source: 'whatsapp',
      });
      expect(r.reply).toContain('no brief matched');
    });

    it('renders the design summary when present', async () => {
      prisma.pRD.findFirst = vi.fn().mockResolvedValue({
        id: 'prd-1',
        title: 'Partner portal',
        architectureDesign: {
          summary: 'React frontend + Fastify API',
          components: [{ name: 'Auth' }, { name: 'Dashboard' }],
          apis: [{ name: 'POST /login' }],
        },
      });
      const svc = new AgentDispatcherService(prisma as any);
      const r = await svc.dispatch({
        text: '@architect abc123',
        tenantId: 't-1',
        source: 'whatsapp',
      });
      expect(r.reply).toContain('Partner portal');
      expect(r.reply).toContain('React frontend + Fastify API');
      expect(r.reply).toContain('2 components');
      expect(r.reply).toContain('1 APIs');
    });
  });

  describe('@supervisor', () => {
    it('shows the pipeline snapshot', async () => {
      prisma = makePrisma({ meetings: 5, prdsTotal: 3, jobsTotal: 7 });
      const svc = new AgentDispatcherService(prisma as any);
      const r = await svc.dispatch({ text: '@supervisor', tenantId: 't-1', source: 'whatsapp' });
      expect(r.reply).toContain('Meetings ingested: 5');
      expect(r.reply).toContain('Briefs created: 3');
      expect(r.reply).toContain('Dev jobs run: 7');
    });
  });
});
