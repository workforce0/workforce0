/**
 * Unit tests for Settings Routes
 *
 * Tests:
 * - GET /: returns settings with masked secrets
 * - PUT /integrations: updates only provided fields, skips ****-prefixed values
 * - PUT /notifications: updates notification preferences
 * - PUT /account: updates account name and organization
 * - POST /integrations/test: tests each integration type
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

// Mock the logger
vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { settingsRoutes } from '../settings.routes.js';

// --- Helpers ---

function makeTenant(overrides: Record<string, any> = {}) {
  return {
    id: 'tenant-001',
    name: 'Test Org',
    settings: {
      auth: { email: 'user@example.com', name: 'Test User', passwordHash: 'salt:hash' },
      integrations: {
        jiraBaseUrl: 'https://test.atlassian.net',
        jiraEmail: 'jira@example.com',
        jiraApiToken: 'jira-token-12345678',
        gchatWebhookUrl: 'https://chat.googleapis.com/v1/spaces/xxx/messages?key=yyy',
        googleServiceAccountKey: '{"type":"service_account","client_email":"sa@proj.iam","private_key":"pk"}',
        googleDriveFolderId: 'folder-123',
      },
      notifications: {
        notifyOnMeetingEnd: true,
        notifyOnPrdGenerated: false,
        notifyOnApprovalNeeded: true,
      },
    },
    ...overrides,
  };
}

function createMockPrisma(tenant: ReturnType<typeof makeTenant> | null = null) {
  return {
    tenant: {
      findUnique: vi.fn().mockResolvedValue(tenant),
      update: vi.fn().mockResolvedValue(tenant),
    },
  };
}

async function buildApp(prisma: ReturnType<typeof createMockPrisma>): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('services', { prisma, auditService: { log: vi.fn() } } as any);

  // Simulate the auth middleware setting tenantId on request
  app.addHook('onRequest', async (request) => {
    (request as any).tenantId = 'tenant-001';
    (request as any).userRole = 'owner';
  });

  await app.register(settingsRoutes);
  await app.ready();
  return app;
}

describe('Settings Routes', () => {
  let app: FastifyInstance;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  // =========================================================================
  // GET /
  // =========================================================================
  describe('GET / (get settings)', () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      mockPrisma = createMockPrisma(makeTenant());
      app = await buildApp(mockPrisma);
    });

    it('returns settings with masked secret fields', async () => {
      const res = await app.inject({ method: 'GET', url: '/' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);

      // Account data
      expect(body.data.account.name).toBe('Test User');
      expect(body.data.account.email).toBe('user@example.com');
      expect(body.data.account.organizationName).toBe('Test Org');

      // Masked secrets: should start with **** and show last 4 chars
      expect(body.data.integrations.jiraApiToken).toMatch(/^\*\*\*\*/);

      // Connection flags
      expect(body.data.integrations.jiraConnected).toBe(true);
      expect(body.data.integrations.gchatConnected).toBe(true);
      expect(body.data.integrations.googleDocsConnected).toBe(true);

      // Non-secret fields returned as-is
      expect(body.data.integrations.jiraBaseUrl).toBe('https://test.atlassian.net');
      expect(body.data.integrations.jiraEmail).toBe('jira@example.com');

      // Notifications with defaults
      expect(body.data.notifications.notifyOnMeetingEnd).toBe(true);
      expect(body.data.notifications.notifyOnPrdGenerated).toBe(false);
    });

    it('returns 404 when tenant not found', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      const res = await app.inject({ method: 'GET', url: '/' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('handles tenant with empty settings gracefully', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-001',
        name: 'Empty Org',
        settings: {},
      });

      const res = await app.inject({ method: 'GET', url: '/' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.account.name).toBe('');
      expect(body.data.notifications.notifyOnMeetingEnd).toBe(true); // default
    });
  });

  // =========================================================================
  // PUT /integrations
  // =========================================================================
  describe('PUT /integrations', () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      mockPrisma = createMockPrisma(makeTenant());
      app = await buildApp(mockPrisma);
    });

    it('updates only provided fields', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/integrations',
        payload: { jiraEmail: 'new@example.com' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().data.message).toBe('Integration settings updated');

      // Check the prisma update was called with merged settings
      const updateCall = mockPrisma.tenant.update.mock.calls[0][0];
      const updatedIntegrations = updateCall.data.settings.integrations;
      expect(updatedIntegrations.jiraEmail).toBe('new@example.com');
      // Original values should be preserved
      expect(updatedIntegrations.jiraBaseUrl).toBe('https://test.atlassian.net');
    });

    it('skips ****-prefixed values (masked secrets)', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/integrations',
        payload: {
          jiraApiToken: '****5678',  // Masked value, should be skipped
          jiraBaseUrl: 'https://new-jira.atlassian.net',  // Real update
        },
      });

      expect(res.statusCode).toBe(200);

      const updateCall = mockPrisma.tenant.update.mock.calls[0][0];
      const updatedIntegrations = updateCall.data.settings.integrations;
      // Masked value should NOT have overwritten the original
      expect(updatedIntegrations.jiraApiToken).toBe('jira-token-12345678');
      // New value should be updated
      expect(updatedIntegrations.jiraBaseUrl).toBe('https://new-jira.atlassian.net');
    });

    it('returns 404 when tenant not found', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PUT',
        url: '/integrations',
        payload: { jiraEmail: 'test@example.com' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('validates URL fields', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/integrations',
        payload: { jiraBaseUrl: 'not-a-url' },
      });

      // Zod validation failure
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('accepts empty strings for URL fields', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/integrations',
        payload: { jiraBaseUrl: '' },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // =========================================================================
  // PUT /notifications
  // =========================================================================
  describe('PUT /notifications', () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      mockPrisma = createMockPrisma(makeTenant());
      app = await buildApp(mockPrisma);
    });

    it('updates notification preferences', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/notifications',
        payload: { notifyOnMeetingEnd: false, notifyOnAgentErrors: true },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);

      const updateCall = mockPrisma.tenant.update.mock.calls[0][0];
      const updatedNotifications = updateCall.data.settings.notifications;
      expect(updatedNotifications.notifyOnMeetingEnd).toBe(false);
      expect(updatedNotifications.notifyOnAgentErrors).toBe(true);
      // Existing value preserved
      expect(updatedNotifications.notifyOnApprovalNeeded).toBe(true);
    });

    it('returns 404 when tenant not found', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PUT',
        url: '/notifications',
        payload: { notifyOnMeetingEnd: false },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // =========================================================================
  // PUT /account
  // =========================================================================
  describe('PUT /account', () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      mockPrisma = createMockPrisma(makeTenant());
      app = await buildApp(mockPrisma);
    });

    it('updates organization name', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/account',
        payload: { organizationName: 'New Org Name' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);

      const updateCall = mockPrisma.tenant.update.mock.calls[0][0];
      expect(updateCall.data.name).toBe('New Org Name');
    });

    it('updates user name in settings.auth', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/account',
        payload: { name: 'New Name' },
      });

      expect(res.statusCode).toBe(200);

      const updateCall = mockPrisma.tenant.update.mock.calls[0][0];
      expect(updateCall.data.settings.auth.name).toBe('New Name');
    });

    it('returns 404 when tenant not found', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PUT',
        url: '/account',
        payload: { name: 'Name' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // =========================================================================
  // POST /integrations/test
  // =========================================================================
  describe('POST /integrations/test', () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      mockPrisma = createMockPrisma(makeTenant());
      app = await buildApp(mockPrisma);
    });

    it('returns not connected when jira credentials missing', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-001',
        name: 'Test',
        settings: { integrations: {} },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/integrations/test',
        payload: { integration: 'jira' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.connected).toBe(false);
      expect(res.json().data.message).toContain('Missing Jira credentials');
    });

    it('validates gchat webhook URL format', async () => {
      // Valid Google Chat URL
      const res = await app.inject({
        method: 'POST',
        url: '/integrations/test',
        payload: { integration: 'gchat' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.connected).toBe(true);
      expect(res.json().data.message).toContain('valid');
    });

    it('rejects invalid gchat webhook URL', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-001',
        name: 'Test',
        settings: { integrations: { gchatWebhookUrl: 'https://evil.com/webhook' } },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/integrations/test',
        payload: { integration: 'gchat' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.connected).toBe(false);
      expect(res.json().data.message).toContain('chat.googleapis.com');
    });

    it('returns not connected when gchat webhook URL missing', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-001',
        name: 'Test',
        settings: { integrations: {} },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/integrations/test',
        payload: { integration: 'gchat' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.connected).toBe(false);
    });

    it('validates gdocs service account key format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/integrations/test',
        payload: { integration: 'gdocs' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.connected).toBe(true);
      expect(res.json().data.message).toContain('sa@proj.iam');
    });

    it('rejects invalid gdocs JSON', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-001',
        name: 'Test',
        settings: { integrations: { googleServiceAccountKey: 'not-json' } },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/integrations/test',
        payload: { integration: 'gdocs' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.connected).toBe(false);
      expect(res.json().data.message).toContain('Invalid JSON');
    });

    it('rejects unknown integration type via Zod validation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/integrations/test',
        payload: { integration: 'unknown' },
      });

      // Zod enum validation rejects before reaching the switch
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('rejects missing integration field via Zod validation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/integrations/test',
        payload: {},
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('rejects jira test with non-atlassian URL (SSRF protection)', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-001',
        name: 'Test',
        settings: {
          integrations: {
            jiraBaseUrl: 'https://evil-internal.local',
            jiraEmail: 'jira@example.com',
            jiraApiToken: 'token123',
          },
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/integrations/test',
        payload: { integration: 'jira' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.connected).toBe(false);
      expect(res.json().data.message).toContain('atlassian.net');
    });

    it('returns 404 when tenant not found', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/integrations/test',
        payload: { integration: 'jira' },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
