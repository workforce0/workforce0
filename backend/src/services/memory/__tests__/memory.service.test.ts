import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryService } from '../memory.service.js';

describe('MemoryService', () => {
  let service: MemoryService;
  let mockPrisma: any;
  let mockRedis: any;

  beforeEach(() => {
    mockPrisma = {
      tenantMemory: {
        upsert: vi.fn().mockResolvedValue({ id: 'm1' }),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        deleteMany: vi.fn(),
      },
    };
    mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      keys: vi.fn().mockResolvedValue([]),
    };
    service = new MemoryService(mockPrisma, mockRedis);
  });

  it('should store memory in both hot tier (Redis) and warm tier (PG)', async () => {
    await service.remember('t1', {
      key: 'code_style', category: 'convention',
      value: { indent: 'tabs' }, source: 'code_review', confidence: 0.9,
    });

    expect(mockRedis.set).toHaveBeenCalledWith(
      'mem:t1:convention:code_style',
      JSON.stringify({ indent: 'tabs' }),
      'EX', 1800
    );
    expect(mockPrisma.tenantMemory.upsert).toHaveBeenCalled();
  });

  it('should recall from hot tier (Redis) first', async () => {
    mockRedis.get.mockResolvedValue(JSON.stringify({ indent: 'tabs' }));

    const result = await service.recall('t1', 'convention', 'code_style');
    expect(result).toEqual({ indent: 'tabs' });
    expect(mockPrisma.tenantMemory.findFirst).not.toHaveBeenCalled();
  });

  it('should fall through to warm tier (PG) on Redis cache miss', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockPrisma.tenantMemory.findFirst.mockResolvedValue({
      id: 'm1', value: { indent: 'spaces' }, confidence: 0.8,
    });

    const result = await service.recall('t1', 'convention', 'code_style');
    expect(result).toEqual({ indent: 'spaces' });
    // Should re-populate Redis
    expect(mockRedis.set).toHaveBeenCalled();
  });

  it('should return null when memory not found in any tier', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockPrisma.tenantMemory.findFirst.mockResolvedValue(null);

    const result = await service.recall('t1', 'convention', 'code_style');
    expect(result).toBeNull();
  });

  it('should track access count on warm tier recall', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockPrisma.tenantMemory.findFirst.mockResolvedValue({
      id: 'm1', value: { indent: 'spaces' }, confidence: 0.8,
    });

    await service.recall('t1', 'convention', 'code_style');
    expect(mockPrisma.tenantMemory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm1' },
        data: expect.objectContaining({ accessCount: { increment: 1 } }),
      })
    );
  });

  it('should retrieve all memories for context building', async () => {
    mockPrisma.tenantMemory.findMany.mockResolvedValue([
      { key: 'code_style', category: 'convention', value: { indent: 'tabs' }, source: 'code_review', confidence: 0.9 },
      { key: 'prd_format', category: 'preference', value: { style: 'user_stories' }, source: 'prd_rejection', confidence: 0.85 },
    ]);

    const memories = await service.getContext('t1', { categories: ['convention', 'preference'] });
    expect(memories.length).toBe(2);
    expect(memories[0].confidence).toBeGreaterThanOrEqual(memories[1].confidence);
  });

  it('should forget memory from both tiers', async () => {
    await service.forget('t1', 'convention', 'code_style');
    expect(mockRedis.del).toHaveBeenCalledWith('mem:t1:convention:code_style');
    expect(mockPrisma.tenantMemory.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', category: 'convention', key: 'code_style' } })
    );
  });
});
