/**
 * =============================================================================
 * TEAM ROSTER API ROUTES
 * =============================================================================
 *
 * Manage team members for role-based communication routing.
 *
 * Endpoints:
 * ----------
 * GET    /team      -> List team members for tenant
 * POST   /team      -> Add team member
 * PUT    /team/:id  -> Update team member
 * DELETE /team/:id  -> Remove team member (soft delete)
 *
 * @module routes/team
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import { createChildLogger } from '../lib/logger.js';
import { requireAdmin } from '../middleware/rbac.middleware.js';

const logger = createChildLogger({ route: 'team' });

const InviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']),
});

const CreateMemberSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  role: z.enum(['founder', 'cto', 'pm', 'developer', 'designer', 'qa']),
  preferredChannel: z.enum(['slack', 'email', 'whatsapp', 'teams', 'sms']).optional(),
  channelIds: z.record(z.string()).optional(),
});

const UpdateMemberSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  role: z.enum(['founder', 'cto', 'pm', 'developer', 'designer', 'qa']).optional(),
  preferredChannel: z.enum(['slack', 'email', 'whatsapp', 'teams', 'sms']).optional(),
  channelIds: z.record(z.string()).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update',
});

export async function teamRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /team
   *
   * List all active team members for the authenticated tenant.
   */
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const prisma = fastify.services.prisma;

    const members = await prisma.teamMember.findMany({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    return reply.send({
      success: true,
      data: members,
    });
  });

  /**
   * POST /team
   *
   * Add a new team member to the tenant's roster.
   */
  fastify.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const body = CreateMemberSchema.parse(request.body);
    const prisma = fastify.services.prisma;

    logger.info({ tenantId, email: body.email, role: body.role }, 'Adding team member');

    // Check if member with this email already exists for the tenant
    const existing = await prisma.teamMember.findUnique({
      where: { tenantId_email: { tenantId, email: body.email } },
    });

    if (existing) {
      // If the member was soft-deleted, re-activate them with updated info
      if (!existing.isActive) {
        const reactivated = await prisma.teamMember.update({
          where: { id: existing.id },
          data: {
            name: body.name,
            role: body.role,
            preferredChannel: body.preferredChannel ?? 'email',
            channelIds: body.channelIds ?? { email: body.email },
            isActive: true,
            discoveredFrom: 'manual',
          },
        });

        logger.info({ tenantId, memberId: reactivated.id }, 'Re-activated team member');

        return reply.status(201).send({
          success: true,
          data: reactivated,
        });
      }

      return reply.status(409).send({
        success: false,
        error: { code: 'DUPLICATE_EMAIL', message: 'A team member with this email already exists' },
      });
    }

    const member = await prisma.teamMember.create({
      data: {
        tenantId,
        name: body.name,
        email: body.email,
        role: body.role,
        preferredChannel: body.preferredChannel ?? 'email',
        channelIds: body.channelIds ?? { email: body.email },
        isActive: true,
        discoveredFrom: 'manual',
      },
    });

    logger.info({ tenantId, memberId: member.id }, 'Team member added');

    return reply.status(201).send({
      success: true,
      data: member,
    });
  });

  /**
   * PUT /team/:id
   *
   * Update an existing team member's info.
   */
  fastify.put('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };
    const body = UpdateMemberSchema.parse(request.body);
    const prisma = fastify.services.prisma;

    logger.info({ tenantId, memberId: id }, 'Updating team member');

    // Verify the member exists and belongs to the tenant
    const existing = await prisma.teamMember.findFirst({
      where: { id, tenantId, isActive: true },
    });

    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Team member not found' },
      });
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.role !== undefined) updateData.role = body.role;
    if (body.preferredChannel !== undefined) updateData.preferredChannel = body.preferredChannel;
    if (body.channelIds !== undefined) updateData.channelIds = body.channelIds;

    const updated = await prisma.teamMember.update({
      where: { id },
      data: updateData,
    });

    logger.info({ tenantId, memberId: id }, 'Team member updated');

    return reply.send({
      success: true,
      data: updated,
    });
  });

  /**
   * POST /team/:id/test-channel
   *
   * Send a test message to the team member via their preferred channel.
   * Used by the "Send test" button in the team settings UI so operators
   * can verify channel addresses before a real workflow routes to them.
   */
  fastify.post('/:id/test-channel', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };
    const prisma = fastify.services.prisma;
    const router = fastify.services.communicationRouter;

    const member = await prisma.teamMember.findFirst({
      where: { id, tenantId, isActive: true },
    });
    if (!member) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Team member not found' },
      });
    }

    const content =
      `Hi ${member.name}, this is a test from Workforce0. ` +
      `If you can read this, your ${member.preferredChannel} channel is wired up correctly. ` +
      `No action needed.`;

    const result = await router.send({
      tenantId,
      recipientId: member.id,
      recipientRole: member.role,
      messageType: 'test',
      content,
    });

    logger.info({ tenantId, memberId: id, channel: result.channel, success: result.success }, 'Test channel ping');

    if (!result.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'DELIVERY_FAILED',
          message:
            result.error ??
            `Couldn't reach ${member.name} on ${member.preferredChannel}. Check the channel address.`,
        },
      });
    }

    return reply.send({
      success: true,
      data: { channel: result.channel, messageLogId: result.messageLogId },
    });
  });

  /**
   * DELETE /team/:id
   *
   * Soft-delete a team member (sets isActive = false).
   */
  fastify.delete('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };
    const prisma = fastify.services.prisma;

    logger.info({ tenantId, memberId: id }, 'Removing team member');

    // Verify the member exists and belongs to the tenant
    const existing = await prisma.teamMember.findFirst({
      where: { id, tenantId, isActive: true },
    });

    if (!existing) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Team member not found' },
      });
    }

    await prisma.teamMember.update({
      where: { id },
      data: { isActive: false },
    });

    logger.info({ tenantId, memberId: id }, 'Team member removed');

    return reply.send({
      success: true,
      message: 'Team member removed',
    });
  });

  // ==========================================================================
  // Invitation Endpoints
  // ==========================================================================

  /**
   * POST /team/invitations - Invite a team member (owner/admin only)
   */
  fastify.post('/invitations', { preHandler: [requireAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const userId = (request as any).userId as string;
    const body = InviteSchema.parse(request.body);
    const prisma = fastify.services.prisma;

    // Check if already a member
    const existingUser = await prisma.user.findFirst({
      where: { tenantId, email: body.email },
    });
    if (existingUser) {
      return reply.status(409).send({
        success: false,
        error: { code: 'ALREADY_MEMBER', message: 'This user is already a member of your organization' },
      });
    }

    // Check if invitation already pending
    const existingInvite = await prisma.invitation.findFirst({
      where: { tenantId, email: body.email, status: 'pending' },
    });
    if (existingInvite) {
      return reply.status(409).send({
        success: false,
        error: { code: 'INVITE_PENDING', message: 'An invitation is already pending for this email' },
      });
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invitation = await prisma.invitation.create({
      data: {
        tenantId,
        email: body.email,
        role: body.role,
        token,
        invitedBy: userId,
        expiresAt,
      },
    });

    logger.info({ tenantId, email: body.email, role: body.role }, 'Invitation created');

    return reply.status(201).send({
      success: true,
      data: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        inviteUrl: `/signup?invite=${token}`,
        expiresAt: invitation.expiresAt,
      },
    });
  });

  /**
   * GET /team/invitations - List pending invitations (owner/admin only)
   */
  fastify.get('/invitations', { preHandler: [requireAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const prisma = fastify.services.prisma;

    const invitations = await prisma.invitation.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return reply.send({ success: true, data: invitations });
  });

  /**
   * DELETE /team/invitations/:id - Revoke an invitation (owner/admin only)
   */
  fastify.delete('/invitations/:id', { preHandler: [requireAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const { id } = request.params as { id: string };
    const prisma = fastify.services.prisma;

    const invitation = await prisma.invitation.findFirst({
      where: { id, tenantId, status: 'pending' },
    });

    if (!invitation) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Invitation not found' },
      });
    }

    await prisma.invitation.update({
      where: { id },
      data: { status: 'expired' },
    });

    return reply.send({ success: true, message: 'Invitation revoked' });
  });
}
