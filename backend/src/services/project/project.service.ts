/**
 * =============================================================================
 * PROJECT SERVICE — P1: project-level isolation
 * =============================================================================
 *
 * Projects are the container every user-facing entity (meeting, brief,
 * engagement, ticket, goal) belongs to. A tenant always has at least one
 * project (auto-created named "Default" on tenant creation and
 * backfilled for existing tenants by the P1 migration).
 *
 * The UI sends an `X-Project-Id` header (or `?projectId=` query param);
 * list endpoints honor it and scope results.
 *
 * Responsibilities:
 *   - CRUD (create / list / findById / update / archive)
 *   - `ensureDefaultFor(tenantId)` — idempotent Default project creation,
 *     called on tenant bootstrap
 *   - `findBySlugOrThrow(tenantId, slug)` — used by URL-based routing
 *
 * @module services/project
 */

import type { PrismaClient } from '../../../prisma/generated/client/index.js';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'ProjectService' });

export interface ProjectDTO {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  isArchived: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDTO(row: any): ProjectDTO {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    color: row.color ?? null,
    isArchived: row.isArchived,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'project';
}

export class ProjectService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: {
    tenantId: string;
    name: string;
    slug?: string;
    description?: string;
    color?: string;
    createdBy?: string;
  }): Promise<ProjectDTO> {
    const baseSlug = input.slug?.trim() || slugify(input.name);
    // Uniqueness is per-tenant; collide-and-retry with a numeric suffix.
    let slug = baseSlug;
    for (let attempt = 2; attempt < 20; attempt++) {
      const clash = await (this.prisma as any).project.findFirst({
        where: { tenantId: input.tenantId, slug },
        select: { id: true },
      });
      if (!clash) break;
      slug = `${baseSlug}-${attempt}`;
    }
    const row = await (this.prisma as any).project.create({
      data: {
        tenantId: input.tenantId,
        name: input.name,
        slug,
        description: input.description ?? null,
        color: input.color ?? null,
        createdBy: input.createdBy ?? null,
      },
    });
    logger.info('Project created', { tenantId: input.tenantId, projectId: row.id, slug });
    return toDTO(row);
  }

  async findById(tenantId: string, id: string): Promise<ProjectDTO | null> {
    const row = await (this.prisma as any).project.findFirst({
      where: { id, tenantId },
    });
    return row ? toDTO(row) : null;
  }

  async findBySlug(tenantId: string, slug: string): Promise<ProjectDTO | null> {
    const row = await (this.prisma as any).project.findFirst({
      where: { tenantId, slug },
    });
    return row ? toDTO(row) : null;
  }

  async listForTenant(
    tenantId: string,
    opts: { includeArchived?: boolean } = {},
  ): Promise<ProjectDTO[]> {
    const rows = (await (this.prisma as any).project.findMany({
      where: {
        tenantId,
        ...(opts.includeArchived ? {} : { isArchived: false }),
      },
      orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
    })) as any[];
    return rows.map(toDTO);
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<Pick<ProjectDTO, 'name' | 'description' | 'color' | 'isArchived'>>,
  ): Promise<ProjectDTO | null> {
    const existing = await this.findById(tenantId, id);
    if (!existing) return null;
    const row = await (this.prisma as any).project.update({
      where: { id },
      data: patch,
    });
    return toDTO(row);
  }

  /**
   * Hard-delete. Fails with a clear error if the project still has
   * referring entities — archive is the safe soft-delete path.
   */
  async remove(tenantId: string, id: string): Promise<{ deleted: boolean; reason?: string }> {
    const project = await this.findById(tenantId, id);
    if (!project) return { deleted: false, reason: 'not_found' };

    // Refuse delete if any scoped entity still points at this project.
    // This is a cheap count; the alternative would be cascading deletes
    // across five tables which we don't want to do silently.
    const [meetings, briefs, engagements, tickets] = await Promise.all([
      (this.prisma as any).meeting.count({ where: { projectId: id } }),
      (this.prisma as any).pRD.count({ where: { projectId: id } }),
      (this.prisma as any).engagement.count({ where: { projectId: id } }),
      (this.prisma as any).ticket.count({ where: { projectId: id } }),
    ]);
    const total = meetings + briefs + engagements + tickets;
    if (total > 0) {
      return { deleted: false, reason: `has ${total} referring rows — archive instead` };
    }
    await (this.prisma as any).project.delete({ where: { id } });
    logger.info('Project deleted', { tenantId, projectId: id });
    return { deleted: true };
  }

  /**
   * Idempotently create the tenant's "Default" project if missing.
   * Called on tenant signup so every tenant has at least one project
   * from day one.
   */
  async ensureDefaultFor(tenantId: string): Promise<ProjectDTO> {
    const existing = await this.findBySlug(tenantId, 'default');
    if (existing) return existing;
    return this.create({
      tenantId,
      name: 'Default',
      slug: 'default',
      description: 'Default project — everything not yet categorized lands here.',
    });
  }
}
