import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArchitectService } from '../architect.service.js';

function makePrisma() {
  const rows = new Map<string, any>();
  const matches = (row: any, where: any) => {
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.tenantId !== undefined && row.tenantId !== where.tenantId) return false;
    return true;
  };
  return {
    rows,
    pRD: {
      findFirst: vi.fn(async ({ where, select }: any) => {
        const existing = rows.get(where.id);
        if (!existing || !matches(existing, where)) return null;
        if (select) {
          const out: Record<string, unknown> = {};
          for (const k of Object.keys(select)) out[k] = existing[k];
          return out;
        }
        return existing;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const existing = rows.get(where.id);
        if (!existing || !matches(existing, where)) return { count: 0 };
        Object.assign(existing, data);
        return { count: 1 };
      }),
    },
  };
}

function fakeGemini(response: string) {
  return {
    generateFreeformText: vi.fn(async () => response),
  };
}

const validDesign = JSON.stringify({
  summary: 'Simple web service with a queue backend.',
  components: [
    { name: 'ApiServer', responsibility: 'HTTP surface', dependencies: ['Queue'] },
    { name: 'Queue', responsibility: 'Background jobs', dependencies: [] },
  ],
  apis: [
    { kind: 'http', name: 'POST /briefs', description: 'submit brief', input: '{title}', output: '{id}' },
  ],
  dataModel: [
    { name: 'briefs', fields: [{ name: 'id', type: 'uuid', nullable: false }] },
  ],
  risks: [{ description: 'Queue backlog', mitigation: 'Autoscale workers' }],
  implementationOrder: ['Schema', 'API handlers', 'Worker'],
});

describe('ArchitectService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let gemini: ReturnType<typeof fakeGemini>;
  let service: ArchitectService;

  beforeEach(() => {
    prisma = makePrisma();
    prisma.rows.set('prd-1', {
      id: 'prd-1',
      tenantId: 'tenant-a',
      status: 'approved',
      title: 'New brief feature',
      summary: 'Turn meetings into briefs.',
      objectives: ['Ship it by Q3'],
      requirements: [{ title: 'Upload', description: 'support .vtt' }],
      acceptanceCriteria: ['Upload < 2s'],
      selectedArchitecture: 'Option A',
      architectureDesign: null,
    });
    gemini = fakeGemini(validDesign);
    service = new ArchitectService(prisma as any, gemini as any);
  });

  it('designFromPrd parses valid JSON and saves to the PRD', async () => {
    const design = await service.designFromPrd('prd-1', 'tenant-a');
    expect(design.components).toHaveLength(2);
    expect(design.apis[0]!.name).toBe('POST /briefs');
    expect(design.generatedAt).toBeDefined();
    expect(gemini.generateFreeformText).toHaveBeenCalledTimes(1);

    const stored = prisma.rows.get('prd-1').architectureDesign;
    expect(stored.components).toHaveLength(2);
  });

  it('getDesign returns the stored design', async () => {
    await service.designFromPrd('prd-1', 'tenant-a');
    const fetched = await service.getDesign('prd-1', 'tenant-a');
    expect(fetched?.apis).toHaveLength(1);
  });

  it('getDesign returns null when PRD has no design yet', async () => {
    expect(await service.getDesign('prd-1', 'tenant-a')).toBeNull();
  });

  it('rejects when PRD not found', async () => {
    await expect(service.designFromPrd('never-existed', 'tenant-a')).rejects.toThrow(/not found/);
  });

  it('rejects when PRD is not approved', async () => {
    prisma.rows.get('prd-1').status = 'draft';
    await expect(service.designFromPrd('prd-1', 'tenant-a')).rejects.toThrow(/not approved/);
  });

  it('strips markdown code fences from model output', async () => {
    gemini.generateFreeformText.mockResolvedValueOnce(
      '```json\n' + validDesign + '\n```',
    );
    const design = await service.designFromPrd('prd-1', 'tenant-a');
    expect(design.components).toHaveLength(2);
  });

  it('throws a useful error when model output is not valid JSON', async () => {
    gemini.generateFreeformText.mockResolvedValueOnce('sorry, I cannot design that');
    await expect(service.designFromPrd('prd-1', 'tenant-a')).rejects.toThrow(/not valid JSON/);
  });

  it('tolerates missing optional fields with empty-array defaults', async () => {
    gemini.generateFreeformText.mockResolvedValueOnce(
      JSON.stringify({ summary: 'Basic design' }),
    );
    const design = await service.designFromPrd('prd-1', 'tenant-a');
    expect(design.summary).toBe('Basic design');
    expect(design.components).toEqual([]);
    expect(design.apis).toEqual([]);
  });

  it('rejects cross-tenant read — tenant B cannot fetch tenant A design', async () => {
    await service.designFromPrd('prd-1', 'tenant-a');
    const leaked = await service.getDesign('prd-1', 'tenant-b');
    expect(leaked).toBeNull();
  });

  it('rejects cross-tenant write — tenant B cannot overwrite tenant A design', async () => {
    await expect(service.designFromPrd('prd-1', 'tenant-b')).rejects.toThrow(/not found/);
    // Original tenant A design untouched
    expect(prisma.rows.get('prd-1').architectureDesign).toBeNull();
  });
});
