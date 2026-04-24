/**
 * =============================================================================
 * SETTINGS API ROUTES
 * =============================================================================
 *
 * Manage tenant integration settings, notification preferences, and account info.
 *
 * Endpoints:
 * ----------
 * GET  /settings              → Get all settings (includes spending data)
 * PUT  /settings/integrations → Update integration credentials
 * PUT  /settings/notifications → Update notification preferences
 * PUT  /settings/account      → Update account info
 * PUT  /settings/spending     → Update spending cap
 * POST /settings/integrations/test → Test an integration connection
 *
 * @module routes/settings
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createChildLogger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { requireAdmin } from '../middleware/rbac.middleware.js';

const logger = createChildLogger({ route: 'settings' });

/**
 * Strip HTML tags from a string to prevent stored XSS.
 */
function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '').trim();
}

const IntegrationSettingsSchema = z.object({
  jiraBaseUrl: z.string().url().optional().or(z.literal('')),
  jiraEmail: z.string().email().optional().or(z.literal('')),
  jiraApiToken: z.string().optional(),
  gchatWebhookUrl: z.string().url().optional().or(z.literal('')),
  googleServiceAccountKey: z.string().optional(),
  googleDriveFolderId: z.string().optional(),
  // Communication channel integrations
  twilioAccountSid: z.string().optional(),
  twilioAuthToken: z.string().optional(),
  twilioPhoneNumber: z.string().optional(),
  slackBotToken: z.string().optional(),
  slackDefaultChannel: z.string().optional(),
  // Dev toolchain
  githubToken: z.string().optional(),
  githubOwner: z.string().optional(),
  githubRepo: z.string().optional(),
  // Email
  sendgridApiKey: z.string().optional(),
  emailFrom: z.string().email().optional().or(z.literal('')),
  // Teams
  teamsWebhookUrl: z.string().url().optional().or(z.literal('')),
});

const NotificationSettingsSchema = z.object({
  notifyOnMeetingEnd: z.boolean().optional(),
  notifyOnPrdGenerated: z.boolean().optional(),
  notifyOnApprovalNeeded: z.boolean().optional(),
  notifyOnTicketsCreated: z.boolean().optional(),
  notifyOnAgentErrors: z.boolean().optional(),
});

const AccountSettingsSchema = z.object({
  name: z.string().min(1).optional(),
  organizationName: z.string().min(1).optional(),
}).refine(data => data.name || data.organizationName, {
  message: 'At least one field (name or organizationName) must be provided',
});

const IntegrationTestSchema = z.object({
  integration: z.enum(['jira', 'gchat', 'gdocs', 'twilio', 'slack', 'github', 'sendgrid', 'teams']),
});

export async function settingsRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /settings
   *
   * Returns all tenant settings (integrations, notifications, account).
   */
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const prisma = fastify.services.prisma;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tenant not found' },
      });
    }

    const settings = tenant.settings as Record<string, any> || {};

    // Return settings without exposing password hash
    const integrations = settings.integrations || {};
    const notifications = settings.notifications || {};

    // Mask sensitive fields (show last 4 chars)
    const maskSecret = (val: string | undefined) => {
      if (!val || val.length < 8) return val ? '****' : '';
      return '****' + val.slice(-4);
    };

    // Fetch spending data
    let spending = { currentSpend: 0, monthlyCap: null as number | null, percentUsed: 0, remaining: null as number | null };
    try {
      const budgetCheck = await fastify.services.usageService.checkBudget(tenantId);
      spending = {
        currentSpend: budgetCheck.currentSpend,
        monthlyCap: budgetCheck.monthlyCap,
        percentUsed: budgetCheck.percentUsed,
        remaining: budgetCheck.remaining,
      };
    } catch {
      // Non-critical — don't fail the whole settings response
    }

    return reply.send({
      success: true,
      data: {
        account: {
          name: settings.auth?.name || '',
          email: settings.auth?.email || '',
          organizationName: tenant.name,
        },
        spending,
        integrations: {
          jiraBaseUrl: integrations.jiraBaseUrl || '',
          jiraEmail: integrations.jiraEmail || '',
          jiraApiToken: maskSecret(integrations.jiraApiToken),
          jiraConnected: !!(integrations.jiraBaseUrl && integrations.jiraApiToken),
          gchatWebhookUrl: integrations.gchatWebhookUrl || '',
          gchatConnected: !!integrations.gchatWebhookUrl,
          googleServiceAccountKey: integrations.googleServiceAccountKey ? '****configured' : '',
          googleDriveFolderId: integrations.googleDriveFolderId || '',
          googleDocsConnected: !!integrations.googleServiceAccountKey,
          // Communication channels
          twilioAccountSid: maskSecret(integrations.twilioAccountSid),
          twilioAuthToken: maskSecret(integrations.twilioAuthToken),
          twilioPhoneNumber: integrations.twilioPhoneNumber || '',
          twilioConnected: !!(integrations.twilioAccountSid && integrations.twilioAuthToken),
          slackBotToken: maskSecret(integrations.slackBotToken),
          slackDefaultChannel: integrations.slackDefaultChannel || '',
          slackConnected: !!integrations.slackBotToken,
          // Dev toolchain
          githubToken: maskSecret(integrations.githubToken),
          githubOwner: integrations.githubOwner || '',
          githubRepo: integrations.githubRepo || '',
          githubConnected: !!integrations.githubToken,
          // Email
          sendgridApiKey: maskSecret(integrations.sendgridApiKey),
          emailFrom: integrations.emailFrom || '',
          sendgridConnected: !!integrations.sendgridApiKey,
          // Teams
          teamsWebhookUrl: integrations.teamsWebhookUrl || '',
          teamsConnected: !!integrations.teamsWebhookUrl,
        },
        notifications: {
          notifyOnMeetingEnd: notifications.notifyOnMeetingEnd ?? true,
          notifyOnPrdGenerated: notifications.notifyOnPrdGenerated ?? true,
          notifyOnApprovalNeeded: notifications.notifyOnApprovalNeeded ?? true,
          notifyOnTicketsCreated: notifications.notifyOnTicketsCreated ?? true,
          notifyOnAgentErrors: notifications.notifyOnAgentErrors ?? true,
        },
      },
    });
  });

  /**
   * PUT /settings/integrations
   *
   * Update integration credentials. Only updates provided fields.
   */
  fastify.put('/integrations', { preHandler: [requireAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const body = IntegrationSettingsSchema.parse(request.body);

    logger.info('Updating integration settings', { tenantId });

    const prisma = fastify.services.prisma;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tenant not found' },
      });
    }

    const settings = (tenant.settings as Record<string, any>) || {};
    const currentIntegrations = settings.integrations || {};

    // Validate Jira URL if provided - must be *.atlassian.net
    if (body.jiraBaseUrl && body.jiraBaseUrl.length > 0) {
      try {
        const jiraUrl = new URL(body.jiraBaseUrl);
        if (!jiraUrl.hostname.endsWith('.atlassian.net')) {
          return reply.status(400).send({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Jira URL must be a *.atlassian.net domain' },
          });
        }
      } catch {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid Jira URL format' },
        });
      }
    }

    // Merge: only update fields that are provided (not undefined)
    const updatedIntegrations = { ...currentIntegrations };
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        // Don't overwrite with masked values
        if (typeof value === 'string' && value.startsWith('****')) continue;
        updatedIntegrations[key] = value;
      }
    }

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        settings: {
          ...settings,
          integrations: updatedIntegrations,
        },
      },
    });

    logger.info('Integration settings updated', { tenantId });

    // Audit log: integration settings changed
    fastify.services.auditService.log({
      tenantId,
      userId: (request as any).userId,
      action: 'settings.integrations.update',
      resource: 'settings',
      after: Object.keys(body).filter(k => (body as Record<string, unknown>)[k] !== undefined),
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return reply.send({
      success: true,
      data: { message: 'Integration settings updated' },
    });
  });

  /**
   * PUT /settings/notifications
   *
   * Update notification preferences.
   */
  fastify.put('/notifications', { preHandler: [requireAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const body = NotificationSettingsSchema.parse(request.body);

    const prisma = fastify.services.prisma;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tenant not found' },
      });
    }

    const settings = (tenant.settings as Record<string, any>) || {};
    const currentNotifications = settings.notifications || {};

    const updatedNotifications = { ...currentNotifications };
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        updatedNotifications[key] = value;
      }
    }

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        settings: {
          ...settings,
          notifications: updatedNotifications,
        },
      },
    });

    // Audit log: notification preferences changed
    fastify.services.auditService.log({
      tenantId,
      userId: (request as any).userId,
      action: 'settings.notifications.update',
      resource: 'settings',
      after: body,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return reply.send({
      success: true,
      data: { message: 'Notification preferences updated' },
    });
  });

  /**
   * PUT /settings/account
   *
   * Update account info (name, organization).
   */
  fastify.put('/account', { preHandler: [requireAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const body = AccountSettingsSchema.parse(request.body);

    const prisma = fastify.services.prisma;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tenant not found' },
      });
    }

    const settings = (tenant.settings as Record<string, any>) || {};
    const updateData: Record<string, any> = {};

    if (body.organizationName) {
      updateData.name = stripHtml(body.organizationName);
    }

    if (body.name && settings.auth) {
      settings.auth.name = stripHtml(body.name);
      updateData.settings = settings;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: updateData,
      });
    }

    // Audit log: account settings changed
    fastify.services.auditService.log({
      tenantId,
      userId: (request as any).userId,
      action: 'settings.account.update',
      resource: 'settings',
      after: { name: body.name, organizationName: body.organizationName },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return reply.send({
      success: true,
      data: { message: 'Account settings updated' },
    });
  });

  /**
   * POST /settings/integrations/test
   *
   * Test an integration connection.
   */
  fastify.post('/integrations/test', { preHandler: [requireAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const body = IntegrationTestSchema.parse(request.body);
    const integration = body.integration;

    logger.info('Testing integration', { tenantId, integration });

    const prisma = fastify.services.prisma;
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tenant not found' },
      });
    }

    const settings = (tenant.settings as Record<string, any>) || {};
    const integrations = settings.integrations || {};

    switch (integration) {
      case 'jira': {
        const { jiraBaseUrl, jiraEmail, jiraApiToken } = integrations;
        if (!jiraBaseUrl || !jiraEmail || !jiraApiToken) {
          return reply.send({
            success: true,
            data: { connected: false, message: 'Missing Jira credentials' },
          });
        }
        // SSRF protection: only allow *.atlassian.net domains
        try {
          const jiraUrl = new URL(jiraBaseUrl);
          if (!jiraUrl.hostname.endsWith('.atlassian.net')) {
            return reply.send({
              success: true,
              data: { connected: false, message: 'Jira URL must be a *.atlassian.net domain' },
            });
          }
        } catch {
          return reply.send({
            success: true,
            data: { connected: false, message: 'Invalid Jira URL format' },
          });
        }
        try {
          const authString = Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64');
          const res = await fetch(`${jiraBaseUrl}/rest/api/3/myself`, {
            headers: { 'Authorization': `Basic ${authString}`, 'Accept': 'application/json' },
          });
          const data = res.ok ? await res.json() : null;
          return reply.send({
            success: true,
            data: {
              connected: res.ok,
              message: res.ok ? `Connected as ${(data as any)?.displayName || jiraEmail}` : `API returned ${res.status}`,
            },
          });
        } catch (err) {
          return reply.send({
            success: true,
            data: { connected: false, message: 'Connection failed: ' + (err as Error).message },
          });
        }
      }

      case 'gchat': {
        const webhookUrl = integrations.gchatWebhookUrl;
        if (!webhookUrl) {
          return reply.send({
            success: true,
            data: { connected: false, message: 'No webhook URL configured' },
          });
        }
        // We can't easily test a webhook without sending a message,
        // but we can validate the URL format
        const isValidUrl = webhookUrl.startsWith('https://chat.googleapis.com/');
        return reply.send({
          success: true,
          data: {
            connected: isValidUrl,
            message: isValidUrl ? 'Webhook URL looks valid' : 'URL should start with https://chat.googleapis.com/',
          },
        });
      }

      case 'gdocs': {
        const saKey = integrations.googleServiceAccountKey;
        if (!saKey) {
          return reply.send({
            success: true,
            data: { connected: false, message: 'No service account key configured' },
          });
        }
        try {
          const parsed = JSON.parse(saKey);
          const hasRequiredFields = !!(parsed.type === 'service_account' && parsed.client_email && parsed.private_key);
          return reply.send({
            success: true,
            data: {
              connected: hasRequiredFields,
              message: hasRequiredFields
                ? `Service account: ${parsed.client_email}`
                : 'Invalid service account key format',
            },
          });
        } catch {
          return reply.send({
            success: true,
            data: { connected: false, message: 'Invalid JSON format' },
          });
        }
      }

      case 'twilio': {
        const { twilioAccountSid, twilioAuthToken } = integrations;
        if (!twilioAccountSid || !twilioAuthToken) {
          return reply.send({
            success: true,
            data: { connected: false, message: 'Missing Twilio Account SID or Auth Token' },
          });
        }
        try {
          const authString = Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64');
          const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioAccountSid)}.json`, {
            headers: { 'Authorization': `Basic ${authString}` },
          });
          const data = res.ok ? (await res.json()) as Record<string, unknown> : null;
          return reply.send({
            success: true,
            data: {
              connected: res.ok,
              message: res.ok
                ? `Connected: ${(data?.friendly_name as string) || twilioAccountSid}`
                : `API returned ${res.status}`,
            },
          });
        } catch (err) {
          return reply.send({
            success: true,
            data: { connected: false, message: 'Connection failed: ' + (err as Error).message },
          });
        }
      }

      case 'slack': {
        const slackToken = integrations.slackBotToken;
        if (!slackToken) {
          return reply.send({
            success: true,
            data: { connected: false, message: 'No Slack bot token configured' },
          });
        }
        try {
          const res = await fetch('https://slack.com/api/auth.test', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${slackToken}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          });
          const data = (await res.json()) as Record<string, unknown>;
          const ok = data.ok === true;
          return reply.send({
            success: true,
            data: {
              connected: ok,
              message: ok
                ? `Connected as ${data.user || 'bot'} in ${data.team || 'workspace'}`
                : `Slack error: ${data.error || 'unknown'}`,
            },
          });
        } catch (err) {
          return reply.send({
            success: true,
            data: { connected: false, message: 'Connection failed: ' + (err as Error).message },
          });
        }
      }

      case 'github': {
        const ghToken = integrations.githubToken;
        if (!ghToken) {
          return reply.send({
            success: true,
            data: { connected: false, message: 'No GitHub token configured' },
          });
        }
        try {
          const res = await fetch('https://api.github.com/user', {
            headers: {
              'Authorization': `Bearer ${ghToken}`,
              'Accept': 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
            },
          });
          const data = res.ok ? (await res.json()) as Record<string, unknown> : null;
          return reply.send({
            success: true,
            data: {
              connected: res.ok,
              message: res.ok
                ? `Connected as ${data?.login || 'unknown'}`
                : `API returned ${res.status}`,
            },
          });
        } catch (err) {
          return reply.send({
            success: true,
            data: { connected: false, message: 'Connection failed: ' + (err as Error).message },
          });
        }
      }

      case 'sendgrid': {
        const sgKey = integrations.sendgridApiKey;
        if (!sgKey) {
          return reply.send({
            success: true,
            data: { connected: false, message: 'No SendGrid API key configured' },
          });
        }
        try {
          const res = await fetch('https://api.sendgrid.com/v3/scopes', {
            headers: { 'Authorization': `Bearer ${sgKey}` },
          });
          return reply.send({
            success: true,
            data: {
              connected: res.ok,
              message: res.ok ? 'SendGrid API key is valid' : `API returned ${res.status}`,
            },
          });
        } catch (err) {
          return reply.send({
            success: true,
            data: { connected: false, message: 'Connection failed: ' + (err as Error).message },
          });
        }
      }

      case 'teams': {
        const teamsUrl = integrations.teamsWebhookUrl;
        if (!teamsUrl) {
          return reply.send({
            success: true,
            data: { connected: false, message: 'No Teams webhook URL configured' },
          });
        }
        // Validate URL format — must be Microsoft webhook domain
        const isValidTeamsUrl = typeof teamsUrl === 'string' && (
          teamsUrl.includes('.webhook.office.com') ||
          teamsUrl.includes('.logic.azure.com') ||
          teamsUrl.includes('microsoft.com')
        );
        return reply.send({
          success: true,
          data: {
            connected: isValidTeamsUrl,
            message: isValidTeamsUrl
              ? 'Teams webhook URL looks valid'
              : 'URL should be a Microsoft Teams incoming webhook URL',
          },
        });
      }

      default:
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_INTEGRATION', message: `Unknown integration: ${integration}` },
        });
    }
  });

  // ===========================================================================
  // PUT /settings/spending — Update monthly spending cap
  // ===========================================================================

  const SpendingCapSchema = z.object({
    monthlyCap: z.number().min(0).max(100000).nullable(),
  });

  fastify.put('/spending', { preHandler: [requireAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const body = SpendingCapSchema.parse(request.body);

    logger.info('Updating spending cap', { tenantId, monthlyCap: body.monthlyCap });

    const prisma = fastify.services.prisma;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tenant not found' },
      });
    }

    const settings = (tenant.settings as Record<string, any>) || {};

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        settings: {
          ...settings,
          spendingCap: body.monthlyCap,
        },
      },
    });

    // Return updated spending data
    const budgetCheck = await fastify.services.usageService.checkBudget(tenantId);

    return reply.send({
      success: true,
      data: {
        currentSpend: budgetCheck.currentSpend,
        monthlyCap: budgetCheck.monthlyCap,
        percentUsed: budgetCheck.percentUsed,
        remaining: budgetCheck.remaining,
      },
    });
  });
}
