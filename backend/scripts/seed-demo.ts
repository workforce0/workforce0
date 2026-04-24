#!/usr/bin/env npx tsx
/**
 * DEMO SEED
 * =============================================================================
 *
 * Populates a fresh install with a realistic demo tenant so new users
 * have something to explore before their first real meeting. Every
 * entity ties to something visible in the UI:
 *
 *   - One tenant ("Demo Workspace") with an owner user
 *   - Three goals in a parent/child tree
 *   - Three meetings (one past, two recent) with transcripts
 *   - Two completed briefs + one draft brief (for approval queue)
 *   - A handful of completed + pending tickets across roles
 *   - Engagement rows tying the meetings to goals
 *
 * Login: demo@workforce0.local / demo-password-123
 *
 * Idempotent: running twice updates-in-place rather than duplicating.
 * Use `--wipe` to nuke the demo tenant first.
 *
 * Usage:
 *   cd backend && npm run seed:demo
 *   cd backend && npm run seed:demo -- --wipe
 */

import { PrismaClient } from '../prisma/generated/client/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import crypto from 'node:crypto';

const DEMO_TENANT_NAME = 'Demo Workspace';
const DEMO_EMAIL = 'demo@workforce0.local';
const DEMO_PASSWORD = 'demo-password-123';

function hashPassword(password: string): string {
  // Same pattern as auth.routes.ts — scrypt with 16-byte salt.
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

async function wipeDemoTenant(prisma: PrismaClient): Promise<void> {
  const tenant = await prisma.tenant.findFirst({ where: { name: DEMO_TENANT_NAME } });
  if (!tenant) return;
  console.error(`Wiping existing demo tenant ${tenant.id}`);
  // Cascade is inconsistent across tables; delete in dependency order.
  const t = tenant.id;
  await (prisma as any).ticketEvent.deleteMany({ where: { ticket: { tenantId: t } } });
  await (prisma as any).ticket.deleteMany({ where: { tenantId: t } });
  await (prisma as any).agentRoleVersion.deleteMany({ where: { tenantId: t } });
  await (prisma as any).agentRole.deleteMany({ where: { tenantId: t } });
  await (prisma as any).clarificationRequest.deleteMany({ where: { task: { tenantId: t } } }).catch(() => {});
  await prisma.agentTask.deleteMany({ where: { tenantId: t } });
  await prisma.pRD.deleteMany({ where: { tenantId: t } });
  await prisma.transcript.deleteMany({ where: { meeting: { tenantId: t } } });
  await prisma.meeting.deleteMany({ where: { tenantId: t } });
  await (prisma as any).engagement.deleteMany({ where: { tenantId: t } });
  await (prisma as any).goal.deleteMany({ where: { tenantId: t } });
  await prisma.user.deleteMany({ where: { tenantId: t } });
  await prisma.tenant.delete({ where: { id: t } });
}

async function main() {
  const wipe = process.argv.includes('--wipe');

  // Prisma 7 needs the pg adapter — match di-container's setup.
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5436/workforce0',
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    if (wipe) await wipeDemoTenant(prisma);

    // 1. Tenant + user (upserted)
    let tenant = await prisma.tenant.findFirst({ where: { name: DEMO_TENANT_NAME } });
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          name: DEMO_TENANT_NAME,
          settings: { spendingCap: 50, dailyTokenBudget: 500_000 } as any,
        },
      });
      console.error(`Created tenant ${tenant.id}`);
    }

    let user = await prisma.user.findFirst({ where: { email: DEMO_EMAIL } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: DEMO_EMAIL,
          passwordHash: hashPassword(DEMO_PASSWORD),
          name: 'Demo User',
          role: 'owner',
          organizationName: 'Demo Workspace',
        },
      });
      console.error(`Created user ${user.email} / ${DEMO_PASSWORD}`);
    }

    // 2. Goals — parent + two children
    const existingGoals = await (prisma as any).goal.findMany({ where: { tenantId: tenant.id } });
    const goalByTitle = new Map<string, any>(existingGoals.map((g: any) => [g.title, g]));

    const q2Goal = goalByTitle.get('Q2: ship voice-first onboarding')
      ?? await (prisma as any).goal.create({
        data: {
          tenantId: tenant.id,
          title: 'Q2: ship voice-first onboarding',
          description: 'Reduce time-to-first-brief for new customers from ~10 min to under 60 seconds.',
          outcome: 'A prospect can call our number and have a structured brief waiting in their inbox.',
          status: 'active',
        },
      });

    const retryGoal = goalByTitle.get('Webhook delivery reliability')
      ?? await (prisma as any).goal.create({
        data: {
          tenantId: tenant.id,
          title: 'Webhook delivery reliability',
          description: 'Customers are losing events when downstream endpoints blip.',
          outcome: 'Zero webhook deliveries dropped; admins notified on persistent failures.',
          parentGoalId: q2Goal.id,
          status: 'active',
        },
      });

    const dialGoal = goalByTitle.get('Twilio dial-in polish')
      ?? await (prisma as any).goal.create({
        data: {
          tenantId: tenant.id,
          title: 'Twilio dial-in polish',
          description: 'Voice call completes to transcript without user confusion.',
          outcome: 'One call → one brief with no clarification loop.',
          parentGoalId: q2Goal.id,
          status: 'active',
        },
      });

    // 3. Meetings + transcripts
    const meetings = [
      {
        title: 'Webhook retry feature',
        goalId: retryGoal.id,
        transcript:
          `PM: We need a simple webhook retry feature. When an outbound webhook fails, the current behaviour just logs and drops it.\n\nDev Lead: Exponential backoff, 5 retries?\n\nPM: Yes — 1s start, 30s cap, 5 attempts. After the last failure, mark it as failed and show admins an "undelivered" list.\n\nQA: Any alerting?\n\nPM: One notification to admins on transition to failed. Use the existing notification infra.`,
      },
      {
        title: 'Voice onboarding kickoff',
        goalId: dialGoal.id,
        transcript:
          `CPO: The big reveal for Q2 is voice-first onboarding. User calls our Twilio number and by the end of the call they have a brief.\n\nDesign: What about confirmation — "Here's what I heard, should I send the brief?"\n\nCPO: Yes. Text confirmation via SMS before we send to email.\n\nDev: We already have Gemini Live + Twilio Media Stream wired. This is mostly UX flow.`,
      },
      {
        title: 'Analytics dashboard review',
        goalId: q2Goal.id,
        transcript:
          `PM: The analytics page is too slow when a tenant has >100 briefs.\n\nEng: It's N+1 on the council votes query. Need to eager-load.\n\nPM: Priority: high. It's the first thing a new exec clicks.`,
      },
    ];

    for (const m of meetings) {
      const existing = await prisma.meeting.findFirst({
        where: { tenantId: tenant.id, title: m.title },
      });
      if (existing) continue;
      const meeting = await prisma.meeting.create({
        data: {
          tenantId: tenant.id,
          title: m.title,
          status: 'completed',
          source: 'upload',
          meetingUrl: '',
          startTime: new Date(Date.now() - 1000 * 60 * 60 * 24 * Math.floor(Math.random() * 14)),
          participants: ['PM', 'Dev Lead', 'QA'],
          uploadedBy: user.id,
        },
      });
      await prisma.transcript.create({
        data: {
          meetingId: meeting.id,
          segments: [],
          fullText: m.transcript,
          duration: 600,
          wordCount: m.transcript.split(/\s+/).length,
          speakers: ['PM', 'Dev Lead', 'QA'],
        },
      });
      await (prisma as any).engagement.create({
        data: {
          tenantId: tenant.id,
          meetingId: meeting.id,
          goalId: m.goalId,
          title: m.title,
          phase: 'analyze_ask',
          status: 'active',
        },
      });
      console.error(`Created meeting "${m.title}"`);
    }

    // 4. Two sample briefs — one approved, one pending
    const webhookMeeting = await prisma.meeting.findFirst({
      where: { tenantId: tenant.id, title: 'Webhook retry feature' },
    });
    if (webhookMeeting && !(await prisma.pRD.findFirst({ where: { meetingId: webhookMeeting.id } }))) {
      const task = await prisma.agentTask.create({
        data: {
          tenantId: tenant.id,
          meetingId: webhookMeeting.id,
          agentType: 'ba_agent',
          status: 'completed',
          input: { type: 'meeting_transcript', meetingId: webhookMeeting.id },
          confidence: 0.9,
          completedAt: new Date(),
        },
      });
      await prisma.pRD.create({
        data: {
          tenantId: tenant.id,
          meetingId: webhookMeeting.id,
          taskId: task.id,
          title: 'Webhook Retry with Exponential Backoff',
          summary: 'Implement retry for failed outbound webhooks with an admin-visible undelivered list.',
          objectives: [
            'Zero webhook deliveries silently dropped',
            'Admins get one notification per persistent failure',
          ] as any,
          requirements: [
            { id: 'FR-001', type: 'functional', title: 'Exponential backoff', description: '1s start, 30s cap, 5 attempts', priority: 'critical' },
            { id: 'FR-002', type: 'functional', title: 'Delivery status column', description: 'pending | delivered | failed', priority: 'critical' },
          ] as any,
          acceptanceCriteria: ['Retries capped at 5', 'Failure notification sent once'] as any,
          outOfScope: ['User-configurable retry counts'] as any,
          assumptions: [] as any,
          risks: [{ description: 'Infinite loop on broken endpoints', impact: 'medium', mitigation: 'Circuit breaker after 20 failures' }] as any,
          confidence: 0.9,
          status: 'approved',
          timeline: '1 week',
        },
      });
      console.error(`Seeded approved Webhook Retry brief`);
    }

    const voiceMeeting = await prisma.meeting.findFirst({
      where: { tenantId: tenant.id, title: 'Voice onboarding kickoff' },
    });
    if (voiceMeeting && !(await prisma.pRD.findFirst({ where: { meetingId: voiceMeeting.id } }))) {
      const task = await prisma.agentTask.create({
        data: {
          tenantId: tenant.id,
          meetingId: voiceMeeting.id,
          agentType: 'ba_agent',
          status: 'completed',
          input: { type: 'meeting_transcript', meetingId: voiceMeeting.id },
          confidence: 0.78,
          completedAt: new Date(),
        },
      });
      await prisma.pRD.create({
        data: {
          tenantId: tenant.id,
          meetingId: voiceMeeting.id,
          taskId: task.id,
          title: 'Voice-first Onboarding',
          summary: 'Let prospects start a brief via a Twilio phone call using Gemini Live.',
          objectives: ['Time-to-first-brief under 60s', 'Zero-setup for the caller'] as any,
          requirements: [
            { id: 'FR-001', type: 'functional', title: 'Inbound call handler', description: 'Twilio webhook routes to Media Stream', priority: 'critical' },
            { id: 'FR-002', type: 'functional', title: 'SMS confirmation', description: 'Text user a summary before emailing brief', priority: 'medium' },
          ] as any,
          acceptanceCriteria: ['Call finishes with SMS summary sent', 'Brief lands in inbox within 2 min'] as any,
          outOfScope: ['Outbound calling from our number'] as any,
          assumptions: ['Users have SMS-capable phones'] as any,
          risks: [{ description: 'Gemini Live latency spikes', impact: 'medium', mitigation: 'Fall back to transcript + silent brief' }] as any,
          confidence: 0.78,
          status: 'draft',
          timeline: '3 weeks',
        },
      });
      console.error(`Seeded draft Voice Onboarding brief (pending approval)`);
    }

    // 5. Demo tickets — role-keyed pull queue samples
    const existingTickets = await (prisma as any).ticket.findMany({ where: { tenantId: tenant.id } });
    if (existingTickets.length === 0) {
      await (prisma as any).ticket.create({
        data: {
          tenantId: tenant.id,
          roleSlug: 'ba_agent',
          goalId: retryGoal.id,
          title: 'Draft brief from webhook retry transcript',
          description: 'Produce structured requirements from the 10m discussion on webhook retries.',
          status: 'done',
          payload: { meetingId: webhookMeeting?.id } as any,
          result: { prdId: 'seed-prd', confidence: 0.9 } as any,
          priority: 500,
          completedAt: new Date(),
        },
      });
      await (prisma as any).ticket.create({
        data: {
          tenantId: tenant.id,
          roleSlug: 'dev_agent',
          goalId: retryGoal.id,
          title: 'Implement webhook retry feature',
          description: 'See the approved Webhook Retry brief.',
          status: 'ready',
          payload: { prdId: 'seed-prd' } as any,
          priority: 200,
        },
      });
      await (prisma as any).ticket.create({
        data: {
          tenantId: tenant.id,
          roleSlug: 'ba_agent',
          goalId: dialGoal.id,
          title: 'Draft brief from voice onboarding kickoff',
          description: 'Needs review — some acceptance criteria vague.',
          status: 'waiting',
          payload: { meetingId: voiceMeeting?.id } as any,
          priority: 300,
        },
      });
      console.error(`Seeded 3 sample tickets`);
    }

    console.error('\n✅ Demo seed complete.');
    console.error(`   login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
    console.error(`   tenant: ${tenant.id}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
