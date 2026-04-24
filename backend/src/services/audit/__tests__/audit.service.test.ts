import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditService, AuditEntry } from '../audit.service.js';

describe('AuditService', () => {
  let prisma: {
    auditLog: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
  };
  let service: AuditService;

  beforeEach(() => {
    prisma = {
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    service = new AuditService(prisma);
  });

  // ─── log() ───────────────────────────────────────────────────────────────

  describe('log()', () => {
    it('creates an audit log entry', async () => {
      const entry: AuditEntry = {
        tenantId: 'tenant-1',
        userId: 'user-1',
        action: 'settings.update',
        resource: 'settings',
        resourceId: 'res-1',
        after: { key: 'value' },
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
      };

      await service.log(entry);

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          userId: 'user-1',
          action: 'settings.update',
          resource: 'settings',
          resourceId: 'res-1',
          before: null,
          after: { key: 'value' },
          ipAddress: '127.0.0.1',
          userAgent: 'Mozilla/5.0',
        },
      });
    });

    it('handles missing optional fields', async () => {
      await service.log({
        tenantId: 'tenant-1',
        action: 'user.login',
        resource: 'user',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          userId: null,
          resourceId: null,
          before: null,
          after: null,
          ipAddress: null,
          userAgent: null,
        }),
      });
    });

    it('never throws on database error', async () => {
      prisma.auditLog.create.mockRejectedValue(new Error('DB down'));

      // Should not throw
      await expect(
        service.log({
          tenantId: 'tenant-1',
          action: 'test.action',
          resource: 'test',
        })
      ).resolves.toBeUndefined();
    });
  });

  // ─── query() ─────────────────────────────────────────────────────────────

  describe('query()', () => {
    it('returns paginated results', async () => {
      const mockEntries = [
        { id: 'a1', action: 'user.login', createdAt: new Date() },
        { id: 'a2', action: 'settings.update', createdAt: new Date() },
      ];
      prisma.auditLog.findMany.mockResolvedValue(mockEntries);
      prisma.auditLog.count.mockResolvedValue(42);

      const result = await service.query('tenant-1');

      expect(result).toEqual({
        entries: mockEntries,
        total: 42,
        limit: 50,
        offset: 0,
      });
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('applies action filter with contains', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.query('tenant-1', { action: 'settings' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            action: { contains: 'settings' },
          }),
        })
      );
    });

    it('applies resource and userId filters', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      await service.query('tenant-1', { resource: 'prd', userId: 'user-1' });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            resource: 'prd',
            userId: 'user-1',
          }),
        })
      );
    });

    it('applies date range filter', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      const from = new Date('2026-01-01');
      const to = new Date('2026-01-31');

      await service.query('tenant-1', { from, to });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: from, lte: to },
          }),
        })
      );
    });

    it('respects custom limit and offset', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      const result = await service.query('tenant-1', { limit: 10, offset: 20 });

      expect(result.limit).toBe(10);
      expect(result.offset).toBe(20);
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 20 })
      );
    });

    it('caps limit at 100', async () => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      prisma.auditLog.count.mockResolvedValue(0);

      const result = await service.query('tenant-1', { limit: 500 });

      expect(result.limit).toBe(100);
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 })
      );
    });
  });
});
