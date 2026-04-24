/**
 * =============================================================================
 * AUDIT LOG SERVICE
 * =============================================================================
 *
 * Records who did what, when, for compliance and debugging.
 *
 * Fire-and-forget: audit logging never blocks the main request.
 * If logging fails, the error is swallowed and logged separately.
 *
 * @module services/audit
 */

import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'AuditService' });

export interface AuditEntry {
  tenantId: string;
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditService {
  private readonly prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  /**
   * Log an audit entry. Fire-and-forget — never throws.
   */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: entry.tenantId,
          userId: entry.userId || null,
          action: entry.action,
          resource: entry.resource,
          resourceId: entry.resourceId || null,
          before: entry.before ?? null,
          after: entry.after ?? null,
          ipAddress: entry.ipAddress || null,
          userAgent: entry.userAgent || null,
        },
      });
    } catch (err) {
      // Never block the main request
      logger.error('Failed to write audit log', {
        action: entry.action,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Query audit logs with pagination and filtering.
   */
  async query(
    tenantId: string,
    options: {
      action?: string;
      resource?: string;
      userId?: string;
      from?: Date;
      to?: Date;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    const where: Record<string, unknown> = { tenantId };

    if (options.action) where.action = { contains: options.action };
    if (options.resource) where.resource = options.resource;
    if (options.userId) where.userId = options.userId;
    if (options.from || options.to) {
      where.createdAt = {
        ...(options.from && { gte: options.from }),
        ...(options.to && { lte: options.to }),
      };
    }

    const limit = Math.min(options.limit || 50, 100);
    const offset = options.offset || 0;

    const [entries, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { entries, total, limit, offset };
  }
}
