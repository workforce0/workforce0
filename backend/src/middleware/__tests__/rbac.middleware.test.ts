import { describe, it, expect, vi } from 'vitest';
import { requireRole, requireAdmin, requireMember, requireOwner } from '../rbac.middleware.js';

function mockReqReply(role?: string) {
  const request = { userRole: role } as any;
  const reply = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as any;
  return { request, reply };
}

describe('RBAC Middleware', () => {
  describe('requireRole', () => {
    it('should allow access when role matches', async () => {
      const { request, reply } = mockReqReply('admin');
      const handler = requireRole(['admin', 'owner']);
      await handler(request, reply);
      expect(reply.status).not.toHaveBeenCalled();
    });

    it('should deny access when role does not match', async () => {
      const { request, reply } = mockReqReply('viewer');
      const handler = requireRole(['admin', 'owner']);
      await handler(request, reply);
      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'INSUFFICIENT_PERMISSIONS' }),
      }));
    });

    it('should deny access when no role present', async () => {
      const { request, reply } = mockReqReply(undefined);
      const handler = requireRole(['admin']);
      await handler(request, reply);
      expect(reply.status).toHaveBeenCalledWith(403);
    });
  });

  describe('convenience guards', () => {
    it('requireOwner allows only owner', async () => {
      const ownerReq = mockReqReply('owner');
      await requireOwner(ownerReq.request, ownerReq.reply);
      expect(ownerReq.reply.status).not.toHaveBeenCalled();

      const adminReq = mockReqReply('admin');
      await requireOwner(adminReq.request, adminReq.reply);
      expect(adminReq.reply.status).toHaveBeenCalledWith(403);
    });

    it('requireAdmin allows owner and admin', async () => {
      const ownerReq = mockReqReply('owner');
      await requireAdmin(ownerReq.request, ownerReq.reply);
      expect(ownerReq.reply.status).not.toHaveBeenCalled();

      const adminReq = mockReqReply('admin');
      await requireAdmin(adminReq.request, adminReq.reply);
      expect(adminReq.reply.status).not.toHaveBeenCalled();

      const memberReq = mockReqReply('member');
      await requireAdmin(memberReq.request, memberReq.reply);
      expect(memberReq.reply.status).toHaveBeenCalledWith(403);
    });

    it('requireMember allows owner, admin, and member', async () => {
      for (const role of ['owner', 'admin', 'member']) {
        const { request, reply } = mockReqReply(role);
        await requireMember(request, reply);
        expect(reply.status).not.toHaveBeenCalled();
      }

      const viewerReq = mockReqReply('viewer');
      await requireMember(viewerReq.request, viewerReq.reply);
      expect(viewerReq.reply.status).toHaveBeenCalledWith(403);
    });
  });
});
