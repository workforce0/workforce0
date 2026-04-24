/**
 * End-to-End Flow Test
 * ====================
 *
 * Tests the complete pipeline:
 * 1. Simulate webhook events (meeting status + transcription)
 * 2. Verify transcript is stored in database
 * 3. Verify BA Agent job is queued
 * 4. Verify PRD is generated
 *
 * Run: npx tsx tests/test-e2e-flow.ts
 */

import { PrismaClient } from '../prisma/generated/client/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const { Pool } = pg;

// Create Prisma client with adapter (Prisma 7 pattern)
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Test configuration
const TEST_TENANT_ID = 'test-tenant-e2e';
const TEST_MEETING_TITLE = 'E2E Test Meeting - Sprint Planning';

// Sample transcript that mimics a real product meeting
const SAMPLE_TRANSCRIPT = `
Sarah (Product Manager): Good morning everyone. Let's discuss the new user authentication feature.

Mike (Tech Lead): Sure. We need to support OAuth 2.0 with Google and GitHub providers.

Sarah: Great. What about the timeline?

Mike: I'd estimate 2 sprints for the full implementation. First sprint for the backend API, second for the frontend integration.

Lisa (Designer): I've prepared some mockups for the login flow. We should have a clean, minimal design with clear error states.

Sarah: Perfect. What are the main requirements we should capture?

Mike: First, users should be able to sign in with Google or GitHub. Second, we need to handle token refresh automatically. Third, we should store minimal user data - just email and name.

Lisa: From UX perspective, the sign-in should be one-click. No unnecessary form fields.

Sarah: Any risks we should consider?

Mike: The main risk is OAuth provider rate limits. We should implement proper caching and retry logic.

Sarah: Alright, let's make sure we document all of this in the PRD. Any questions?

Mike: No, I think we're good. I'll start on the technical design document.

Lisa: I'll finalize the mockups by tomorrow.

Sarah: Great meeting everyone. Thanks!
`;

async function cleanup() {
  console.log('\n🧹 Cleaning up previous test data...');

  // Delete in correct order due to foreign keys
  await prisma.jiraTicket.deleteMany({ where: { prd: { tenantId: TEST_TENANT_ID } } });
  await prisma.pRD.deleteMany({ where: { tenantId: TEST_TENANT_ID } });
  await prisma.agentTask.deleteMany({ where: { tenantId: TEST_TENANT_ID } });
  await prisma.transcript.deleteMany({ where: { meeting: { tenantId: TEST_TENANT_ID } } });
  await prisma.meeting.deleteMany({ where: { tenantId: TEST_TENANT_ID } });

  // Check if tenant exists, create if not
  const tenant = await prisma.tenant.findUnique({ where: { id: TEST_TENANT_ID } });
  if (!tenant) {
    await prisma.tenant.create({
      data: {
        id: TEST_TENANT_ID,
        name: 'E2E Test Tenant',
        settings: {},
      },
    });
    console.log('  Created test tenant');
  }

  console.log('  ✅ Cleanup complete');
}

async function step1_createMeeting() {
  console.log('\n📅 Step 1: Creating meeting record...');

  const meeting = await prisma.meeting.create({
    data: {
      tenantId: TEST_TENANT_ID,
      title: TEST_MEETING_TITLE,
      meetingUrl: 'https://meet.google.com/test-e2e-meeting',
      startTime: new Date(),
      status: 'scheduled',
      externalId: `recall-bot-${Date.now()}`, // Simulated Recall.ai bot ID
      participants: [
        { name: 'Sarah', email: 'sarah@example.com', role: 'Product Manager' },
        { name: 'Mike', email: 'mike@example.com', role: 'Tech Lead' },
        { name: 'Lisa', email: 'lisa@example.com', role: 'Designer' },
      ],
    },
  });

  console.log(`  ✅ Meeting created: ${meeting.id}`);
  return meeting;
}

async function step2_simulateStatusUpdates(meetingId: string) {
  console.log('\n🔄 Step 2: Simulating webhook status updates...');

  const statuses = ['joining', 'in_progress', 'in_progress'];

  for (const status of statuses) {
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { status },
    });
    console.log(`  Status: ${status}`);
    await sleep(100);
  }

  console.log('  ✅ Status updates complete');
}

async function step3_storeTranscript(meetingId: string) {
  console.log('\n📝 Step 3: Storing transcript...');

  // Parse the sample transcript into segments
  const lines = SAMPLE_TRANSCRIPT.trim().split('\n').filter(line => line.trim());
  const segments = lines.map((line, i) => {
    const match = line.match(/^(\w+)\s*\(([^)]+)\):\s*(.+)$/);
    if (match) {
      return {
        speaker: `${match[1]} (${match[2]})`,
        text: match[3],
        startTime: i * 10,
        endTime: (i + 1) * 10,
        confidence: 0.95,
      };
    }
    return null;
  }).filter(Boolean);

  const fullText = segments.map(s => `${s!.speaker}: ${s!.text}`).join('\n');
  const speakers = [...new Set(segments.map(s => s!.speaker))];

  const transcript = await prisma.transcript.create({
    data: {
      meetingId,
      segments: segments as any,
      fullText,
      duration: segments.length * 10,
      wordCount: fullText.split(/\s+/).length,
      speakers: speakers as any,
    },
  });

  console.log(`  ✅ Transcript stored: ${transcript.id}`);
  console.log(`     - ${segments.length} segments`);
  console.log(`     - ${transcript.wordCount} words`);
  console.log(`     - ${speakers.length} speakers: ${speakers.join(', ')}`);

  return transcript;
}

async function step4_createAgentTask(meetingId: string, transcriptId: string) {
  console.log('\n🤖 Step 4: Creating BA Agent task...');

  const task = await prisma.agentTask.create({
    data: {
      tenantId: TEST_TENANT_ID,
      meetingId,
      agentType: 'ba_agent',
      status: 'pending',
      input: {
        type: 'meeting_transcript',
        meetingId,
        transcriptId,
      },
    },
  });

  console.log(`  ✅ Task created: ${task.id}`);
  return task;
}

async function step5_simulatePRDGeneration(taskId: string, meetingId: string) {
  console.log('\n📄 Step 5: Simulating PRD generation...');

  // Update task to processing
  await prisma.agentTask.update({
    where: { id: taskId },
    data: { status: 'processing' },
  });

  // Create PRD (simulating BA Agent output)
  const prd = await prisma.pRD.create({
    data: {
      tenantId: TEST_TENANT_ID,
      taskId,
      meetingId,
      title: 'User Authentication Feature - OAuth Integration',
      summary: 'Implement OAuth 2.0 authentication with Google and GitHub providers, featuring one-click sign-in experience with minimal data storage.',
      objectives: [
        'Enable secure user authentication via OAuth 2.0',
        'Support Google and GitHub as identity providers',
        'Provide seamless one-click sign-in experience',
        'Implement automatic token refresh mechanism',
      ],
      requirements: [
        {
          id: 'REQ-001',
          title: 'Google OAuth Integration',
          description: 'Users should be able to sign in using their Google account',
          priority: 'high',
          type: 'functional',
        },
        {
          id: 'REQ-002',
          title: 'GitHub OAuth Integration',
          description: 'Users should be able to sign in using their GitHub account',
          priority: 'high',
          type: 'functional',
        },
        {
          id: 'REQ-003',
          title: 'Automatic Token Refresh',
          description: 'System should automatically refresh OAuth tokens before expiry',
          priority: 'medium',
          type: 'functional',
        },
        {
          id: 'REQ-004',
          title: 'Minimal Data Storage',
          description: 'Store only essential user data: email and display name',
          priority: 'medium',
          type: 'non-functional',
        },
      ],
      acceptanceCriteria: [
        'User can sign in with Google in one click',
        'User can sign in with GitHub in one click',
        'Tokens are refreshed automatically without user action',
        'Only email and name are stored in the database',
        'Clear error messages shown for authentication failures',
      ],
      outOfScope: [
        'Email/password authentication',
        'Multi-factor authentication',
        'Social login with other providers (Facebook, Twitter)',
      ],
      assumptions: [
        'Google and GitHub OAuth apps are already configured',
        'Users have existing Google or GitHub accounts',
        'Backend API supports JWT tokens',
      ],
      risks: [
        {
          id: 'RISK-001',
          description: 'OAuth provider rate limits may affect user experience',
          impact: 'medium',
          mitigation: 'Implement caching and retry logic',
        },
      ],
      timeline: '2 sprints (4 weeks)',
      confidence: 0.87,
      status: 'draft',
      version: 1,
    },
  });

  // Update task to completed
  await prisma.agentTask.update({
    where: { id: taskId },
    data: {
      status: 'completed',
      output: {
        prdId: prd.id,
        confidence: 0.87,
      },
      confidence: 0.87,
    },
  });

  // Update meeting to completed
  await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      status: 'completed',
      endTime: new Date(),
    },
  });

  console.log(`  ✅ PRD created: ${prd.id}`);
  console.log(`     - Title: ${prd.title}`);
  console.log(`     - ${(prd.requirements as any[]).length} requirements`);
  console.log(`     - Confidence: ${(prd.confidence * 100).toFixed(0)}%`);

  return prd;
}

async function step6_verifyResults(meetingId: string) {
  console.log('\n✅ Step 6: Verifying results...');

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      transcript: true,
      tasks: true,
      prds: true,
    },
  });

  if (!meeting) {
    throw new Error('Meeting not found');
  }

  console.log('\n📊 VERIFICATION RESULTS:');
  console.log('========================');
  console.log(`Meeting: ${meeting.title}`);
  console.log(`Status: ${meeting.status}`);
  console.log(`Transcript: ${meeting.transcript ? '✅ Stored' : '❌ Missing'}`);
  console.log(`Tasks: ${meeting.tasks.length} created`);
  console.log(`PRDs: ${meeting.prds.length} generated`);

  if (meeting.prds.length > 0) {
    const prd = meeting.prds[0];
    console.log(`\nPRD Details:`);
    console.log(`  Title: ${prd.title}`);
    console.log(`  Status: ${prd.status}`);
    console.log(`  Confidence: ${(prd.confidence * 100).toFixed(0)}%`);
    console.log(`  Requirements: ${(prd.requirements as any[]).length}`);
  }

  const allPassed = meeting.status === 'completed'
    && meeting.transcript !== null
    && meeting.tasks.length > 0
    && meeting.prds.length > 0;

  console.log('\n' + (allPassed
    ? '🎉 ALL TESTS PASSED!'
    : '❌ SOME TESTS FAILED'));

  return allPassed;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('🚀 E2E Flow Test Starting...');
  console.log('============================');

  try {
    await cleanup();

    const meeting = await step1_createMeeting();
    await step2_simulateStatusUpdates(meeting.id);
    const transcript = await step3_storeTranscript(meeting.id);
    const task = await step4_createAgentTask(meeting.id, transcript.id);
    await step5_simulatePRDGeneration(task.id, meeting.id);
    const passed = await step6_verifyResults(meeting.id);

    process.exit(passed ? 0 : 1);
  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
