// =============================================================================
// Email Digest Service
// =============================================================================
//
// Sends a daily summary email to all users in each tenant, showing what their
// AI workforce accomplished in the past 24 hours.
//
// Called by the EMAIL_DIGEST queue processor, which runs on a daily cron
// (default: 8 AM UTC). Works in stub mode when SendGrid is not configured —
// the EmailChannel logs rather than sending.
// =============================================================================

import { createChildLogger } from '../../lib/logger.js';
import type { EmailChannel } from './channels/email.channel.js';

const log = createChildLogger({ module: 'email-digest' });

export class EmailDigestService {
  constructor(
    private prisma: any,
    private emailChannel: EmailChannel | undefined,
  ) {}

  /**
   * Build and send the daily digest for a single tenant.
   *
   * Skips silently when there is no activity in the past 24 hours.
   */
  async sendDailyDigest(tenantId: string): Promise<void> {
    if (!this.emailChannel) {
      log.warn('EmailChannel not available — skipping digest', { tenantId });
      return;
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Query activity counts in parallel
    const [meetings, prds, jobs, tasks] = await Promise.all([
      this.prisma.meeting.count({ where: { tenantId, createdAt: { gte: since } } }),
      this.prisma.pRD.count({ where: { tenantId, createdAt: { gte: since } } }),
      this.prisma.agentJob.count({ where: { tenantId, createdAt: { gte: since }, status: 'done' } }),
      // N6: count tickets that reached 'done' (the Ticket-native value
      // that subsumes AgentTask.status='completed').
      (this.prisma as any).ticket.count({ where: { tenantId, createdAt: { gte: since }, status: 'done' } }),
    ]);

    // Skip if nothing happened
    if (meetings + prds + jobs + tasks === 0) {
      log.info('No activity for digest — skipping', { tenantId });
      return;
    }

    // Get all users in this tenant to send to
    const users = await this.prisma.user.findMany({
      where: { tenantId },
      select: { email: true, name: true },
    });

    if (users.length === 0) {
      log.info('No users found for tenant — skipping digest', { tenantId });
      return;
    }

    // Rough ROI estimate (displayed in the email)
    const hoursSaved = (prds * 4) + (jobs * 40);
    const moneySaved = (prds * 200) + (jobs * 4000);

    const subject = `Workforce0 Daily Digest — ${prds} brief${prds !== 1 ? 's' : ''}, ${jobs} feature${jobs !== 1 ? 's' : ''} shipped`;
    const html = buildDigestHtml({ meetings, prds, jobs, tasks, hoursSaved, moneySaved });

    // Plain-text fallback for email clients that don't render HTML
    const text = buildDigestText({ meetings, prds, jobs, tasks, hoursSaved, moneySaved });

    for (const user of users) {
      try {
        await this.emailChannel.send({
          to: user.email,
          content: text,
          metadata: { subject, html },
        });
        log.info('Digest sent', { email: user.email, tenantId });
      } catch (err) {
        log.error('Failed to send digest', {
          email: user.email,
          tenantId,
          error: (err as Error).message,
        });
      }
    }
  }

  /**
   * Send the daily digest for every tenant in the database.
   *
   * Errors for individual tenants are caught and logged so one bad tenant
   * cannot block the others.
   */
  async sendDigestToAllTenants(): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    log.info('Starting daily digest run', { tenantCount: tenants.length });

    for (const tenant of tenants) {
      try {
        await this.sendDailyDigest(tenant.id);
      } catch (err) {
        log.error('Failed to send digest for tenant', {
          tenantId: tenant.id,
          error: (err as Error).message,
        });
      }
    }

    log.info('Daily digest run complete', { tenantCount: tenants.length });
  }
}

// =============================================================================
// Email template helpers
// =============================================================================

interface DigestData {
  meetings: number;
  prds: number;
  jobs: number;
  tasks: number;
  hoursSaved: number;
  moneySaved: number;
}

function buildDigestHtml(data: DigestData): string {
  return `
<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1a1a1a;">

  <!-- Header -->
  <div style="text-align: center; margin-bottom: 24px;">
    <h1 style="color: #b45309; font-size: 24px; margin: 0;">Workforce0</h1>
    <p style="color: #888; font-size: 14px; margin: 4px 0 0;">Your AI Workforce — Daily Digest</p>
  </div>

  <!-- Stats card -->
  <div style="background: linear-gradient(135deg, #fffbeb, #fef3c7); border-radius: 12px; padding: 24px; margin-bottom: 20px;">
    <h2 style="margin: 0 0 20px; font-size: 18px; color: #92400e;">Today's Impact</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
      <tr>
        <td style="text-align: center; padding: 8px;">
          <div style="font-size: 32px; font-weight: 700; color: #1a1a2e;">${data.meetings}</div>
          <div style="font-size: 12px; color: #666; margin-top: 4px;">Meetings Processed</div>
        </td>
        <td style="text-align: center; padding: 8px;">
          <div style="font-size: 32px; font-weight: 700; color: #1a1a2e;">${data.prds}</div>
          <div style="font-size: 12px; color: #666; margin-top: 4px;">Briefs Generated</div>
        </td>
        <td style="text-align: center; padding: 8px;">
          <div style="font-size: 32px; font-weight: 700; color: #b45309;">${data.jobs}</div>
          <div style="font-size: 12px; color: #666; margin-top: 4px;">Features Shipped</div>
        </td>
        <td style="text-align: center; padding: 8px;">
          <div style="font-size: 32px; font-weight: 700; color: #16a34a;">${data.hoursSaved} hrs</div>
          <div style="font-size: 12px; color: #666; margin-top: 4px;">~$${data.moneySaved.toLocaleString()} Saved</div>
        </td>
      </tr>
    </table>
  </div>

  ${data.tasks > 0 ? `
  <!-- Tasks row -->
  <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
    <p style="margin: 0; font-size: 14px; color: #374151;">
      <strong>${data.tasks}</strong> agent task${data.tasks !== 1 ? 's' : ''} completed across your workforce.
    </p>
  </div>
  ` : ''}

  <!-- CTA -->
  <div style="text-align: center; padding: 16px;">
    <a href="#" style="background: #b45309; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block;">View Dashboard</a>
  </div>

  <!-- Footer -->
  <div style="text-align: center; margin-top: 28px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
    <p style="color: #9ca3af; font-size: 11px; margin: 0;">Workforce0 — Your AI Workforce</p>
  </div>

</div>
  `.trim();
}

function buildDigestText(data: DigestData): string {
  const lines = [
    'Workforce0 — Daily Digest',
    '=========================',
    '',
    "Here's what your AI workforce accomplished in the last 24 hours:",
    '',
    `  Meetings processed : ${data.meetings}`,
    `  Briefs generated   : ${data.prds}`,
    `  Features shipped   : ${data.jobs}`,
    `  Tasks completed    : ${data.tasks}`,
    '',
    `Estimated time saved : ${data.hoursSaved} hours`,
    `Estimated cost saved : $${data.moneySaved.toLocaleString()}`,
    '',
    '---',
    'Workforce0',
  ];
  return lines.join('\n');
}
