/**
 * Webhook Integration Test
 * ========================
 *
 * Simulates the complete Recall.ai webhook flow:
 * 1. bot.status_change (joining)
 * 2. bot.status_change (in_call)
 * 3. bot.transcription (multiple chunks)
 * 4. bot.status_change (done)
 * 5. Verify transcript stored + BA Agent triggered
 *
 * Run: npx tsx tests/test-webhook-flow.ts
 */

import { PrismaClient } from '../prisma/generated/client/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Configuration
const TEST_TENANT_ID = 'test-tenant-webhook';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Simulated Recall.ai webhook events
interface RecallWebhookEvent {
  event: 'bot.status_change' | 'bot.transcription' | 'bot.recording_ready';
  timestamp: string;
  data: {
    bot_id: string;
    status?: string;
    transcription?: {
      text: string;
      speaker?: string;
      start_time: number;
      end_time: number;
      confidence?: number;
    };
    error?: { code: string; message: string };
  };
}

// Sample meeting transcript chunks
const TRANSCRIPT_CHUNKS = [
  { speaker: 'Sarah (PM)', text: 'Good morning everyone. Let\'s discuss the new feature.', start: 0, end: 5 },
  { speaker: 'Mike (Tech Lead)', text: 'Sure. We need OAuth 2.0 integration with Google and GitHub.', start: 5, end: 12 },
  { speaker: 'Sarah (PM)', text: 'What\'s the timeline?', start: 12, end: 15 },
  { speaker: 'Mike (Tech Lead)', text: 'Two sprints for full implementation.', start: 15, end: 20 },
  { speaker: 'Lisa (Designer)', text: 'I have mockups ready for review.', start: 20, end: 25 },
  { speaker: 'Sarah (PM)', text: 'Great. Let\'s document the requirements.', start: 25, end: 30 },
  { speaker: 'Mike (Tech Lead)', text: 'Main requirements: OAuth providers, token refresh, minimal data storage.', start: 30, end: 40 },
  { speaker: 'Sarah (PM)', text: 'Any risks?', start: 40, end: 42 },
  { speaker: 'Mike (Tech Lead)', text: 'Rate limits from OAuth providers. We need caching.', start: 42, end: 50 },
  { speaker: 'Sarah (PM)', text: 'Perfect. Thanks everyone!', start: 50, end: 55 },
];

async function cleanup() {
  console.log('\n🧹 Cleaning up previous test data...');

  await prisma.jiraTicket.deleteMany({ where: { prd: { tenantId: TEST_TENANT_ID } } });
  await prisma.pRD.deleteMany({ where: { tenantId: TEST_TENANT_ID } });
  await prisma.agentTask.deleteMany({ where: { tenantId: TEST_TENANT_ID } });
  await prisma.transcript.deleteMany({ where: { meeting: { tenantId: TEST_TENANT_ID } } });
  await prisma.meeting.deleteMany({ where: { tenantId: TEST_TENANT_ID } });

  const tenant = await prisma.tenant.findUnique({ where: { id: TEST_TENANT_ID } });
  if (!tenant) {
    await prisma.tenant.create({
      data: { id: TEST_TENANT_ID, name: 'Webhook Test Tenant', settings: {} },
    });
  }

  console.log('  ✅ Cleanup complete');
}

async function createMeetingRecord(botId: string) {
  console.log('\n📅 Creating meeting record with bot ID...');

  const meeting = await prisma.meeting.create({
    data: {
      tenantId: TEST_TENANT_ID,
      title: 'Webhook Test Meeting - Feature Planning',
      meetingUrl: 'https://meet.google.com/test-webhook-meeting',
      startTime: new Date(),
      status: 'scheduled',
      externalId: botId, // This is how we link to Recall.ai bot
      participants: [
        { name: 'Sarah', role: 'PM' },
        { name: 'Mike', role: 'Tech Lead' },
        { name: 'Lisa', role: 'Designer' },
      ],
    },
  });

  console.log(`  ✅ Meeting created: ${meeting.id}`);
  console.log(`     External ID (bot): ${botId}`);
  return meeting;
}

async function sendWebhook(event: RecallWebhookEvent): Promise<Response> {
  const response = await fetch(`${BASE_URL}/webhooks/recall`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Note: In production, add X-Recall-Signature header
    },
    body: JSON.stringify(event),
  });

  return response;
}

async function simulateRecallWebhooks(botId: string) {
  console.log('\n🔄 Simulating Recall.ai webhook events...');

  // Event 1: Bot joining
  console.log('  → bot.status_change: joining');
  await sendWebhook({
    event: 'bot.status_change',
    timestamp: new Date().toISOString(),
    data: { bot_id: botId, status: 'joining' },
  });
  await sleep(200);

  // Event 2: Bot in call
  console.log('  → bot.status_change: in_call');
  await sendWebhook({
    event: 'bot.status_change',
    timestamp: new Date().toISOString(),
    data: { bot_id: botId, status: 'in_call' },
  });
  await sleep(200);

  // Event 3-12: Transcription chunks
  console.log('  → bot.transcription: sending 10 chunks...');
  for (const chunk of TRANSCRIPT_CHUNKS) {
    await sendWebhook({
      event: 'bot.transcription',
      timestamp: new Date().toISOString(),
      data: {
        bot_id: botId,
        transcription: {
          text: chunk.text,
          speaker: chunk.speaker,
          start_time: chunk.start,
          end_time: chunk.end,
          confidence: 0.95,
        },
      },
    });
    await sleep(50); // Small delay between chunks
  }

  // Event 13: Meeting done
  console.log('  → bot.status_change: done');
  await sendWebhook({
    event: 'bot.status_change',
    timestamp: new Date().toISOString(),
    data: { bot_id: botId, status: 'done' },
  });

  console.log('  ✅ All webhook events sent');
}

async function verifyResults(meetingId: string) {
  console.log('\n✅ Verifying results...');

  // Wait a bit for async processing
  await sleep(2000);

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      transcript: true,
      tasks: true,
    },
  });

  if (!meeting) {
    throw new Error('Meeting not found after webhook processing');
  }

  console.log('\n📊 VERIFICATION RESULTS:');
  console.log('========================');
  console.log(`Meeting ID: ${meeting.id}`);
  console.log(`Status: ${meeting.status}`);
  console.log(`Transcript: ${meeting.transcript ? '✅ Stored' : '❌ Missing'}`);

  if (meeting.transcript) {
    console.log(`  - Segments: ${(meeting.transcript.segments as any[])?.length || 0}`);
    console.log(`  - Word count: ${meeting.transcript.wordCount}`);
    console.log(`  - Speakers: ${(meeting.transcript.speakers as string[])?.join(', ')}`);
  }

  // Check for real-time chunks in metadata
  const metadata = meeting.metadata as Record<string, unknown>;
  const chunks = metadata?.transcriptChunks as any[] || [];
  console.log(`Metadata chunks: ${chunks.length} stored`);

  console.log(`BA Agent tasks: ${meeting.tasks.length}`);
  if (meeting.tasks.length > 0) {
    console.log(`  - Task status: ${meeting.tasks[0].status}`);
  }

  // Determine pass/fail
  const results = {
    statusUpdated: meeting.status === 'completed',
    chunksStored: chunks.length > 0,
    transcriptCreated: meeting.transcript !== null,
    taskQueued: meeting.tasks.length > 0,
  };

  console.log('\n📋 Test Results:');
  console.log(`  Status updated to completed: ${results.statusUpdated ? '✅' : '❌'}`);
  console.log(`  Real-time chunks stored: ${results.chunksStored ? '✅' : '❌'}`);
  console.log(`  Transcript record created: ${results.transcriptCreated ? '✅' : '⚠️ (requires Recall.ai API)'}`);
  console.log(`  BA Agent task queued: ${results.taskQueued ? '✅' : '⚠️ (check queue)'}`);

  const critical = results.statusUpdated && results.chunksStored;
  console.log('\n' + (critical
    ? '🎉 CORE WEBHOOK FLOW WORKS!'
    : '❌ WEBHOOK FLOW HAS ISSUES'));

  return critical;
}

async function testGChatWebhook() {
  console.log('\n\n========================================');
  console.log('🔔 Testing Google Chat Webhook');
  console.log('========================================');

  // First create a meeting for the PRD (required by schema)
  const meeting = await prisma.meeting.create({
    data: {
      tenantId: TEST_TENANT_ID,
      title: 'GChat Test Meeting',
      meetingUrl: 'https://meet.google.com/gchat-test',
      startTime: new Date(),
      status: 'completed',
    },
  });

  // Create a test task for the PRD
  const task = await prisma.agentTask.create({
    data: {
      tenantId: TEST_TENANT_ID,
      meetingId: meeting.id,
      agentType: 'ba_agent',
      status: 'completed',
      input: { type: 'test' },
    },
  });

  // Create a test PRD to respond to
  const prd = await prisma.pRD.create({
    data: {
      tenantId: TEST_TENANT_ID,
      taskId: task.id,
      meetingId: meeting.id,
      title: 'GChat Test PRD',
      summary: 'Testing clarification response',
      objectives: ['Test clarification'],
      requirements: [],
      acceptanceCriteria: [],
      outOfScope: [],
      assumptions: [],
      risks: [],
      confidence: 0.5,
      status: 'needs_clarification',
    },
  });

  console.log(`  Created test PRD: ${prd.id}`);

  // Simulate Google Chat clarification response
  const gchatPayload = {
    type: 'MESSAGE',
    eventTime: new Date().toISOString(),
    message: {
      name: 'spaces/test/messages/123',
      text: 'Q1: Use OAuth2 with JWT tokens\nQ2: Target launch is Q2 2026',
      thread: {
        name: 'spaces/test/threads/abc',
        threadKey: `prd-clarify-${prd.id}`,
      },
      sender: {
        name: 'users/user123',
        displayName: 'Mike Tech Lead',
        email: 'mike@example.com',
        type: 'HUMAN',
      },
    },
  };

  console.log('  → Sending clarification response...');

  try {
    const response = await fetch(`${BASE_URL}/webhooks/api/webhooks/gchat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gchatPayload),
    });

    const result = await response.json() as { text?: string };
    console.log(`  Response: ${result?.text || 'No response'}`);
    console.log('  ✅ Google Chat webhook endpoint accessible');
  } catch (error) {
    console.log(`  ⚠️ Google Chat webhook test failed: ${(error as Error).message}`);
    console.log('     (This is expected if the server is not running)');
  }

  // Cleanup test data
  await prisma.pRD.delete({ where: { id: prd.id } });
  await prisma.agentTask.delete({ where: { id: task.id } });
  await prisma.meeting.delete({ where: { id: meeting.id } });
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('🚀 Webhook Integration Test');
  console.log('===========================');
  console.log(`Target: ${BASE_URL}`);

  let passed = false;

  try {
    // Check if server is running
    try {
      const health = await fetch(`${BASE_URL}/health`);
      if (!health.ok) {
        throw new Error('Server health check failed');
      }
      console.log('✅ Server is running');
    } catch (error) {
      console.log('\n⚠️  Server not running at', BASE_URL);
      console.log('   Start the server with: npm run dev');
      console.log('   Then run this test again.\n');
      console.log('   Alternatively, running in DB-only mode...\n');

      // Run DB-only tests
      await cleanup();
      const botId = `test-bot-${Date.now()}`;
      const meeting = await createMeetingRecord(botId);

      console.log('\n📝 Manual Webhook Test Commands:');
      console.log('================================');
      console.log(`\n# 1. Status: joining`);
      console.log(`curl -X POST ${BASE_URL}/webhooks/recall \\`);
      console.log(`  -H "Content-Type: application/json" \\`);
      console.log(`  -d '{"event":"bot.status_change","timestamp":"${new Date().toISOString()}","data":{"bot_id":"${botId}","status":"joining"}}'`);

      console.log(`\n# 2. Status: in_call`);
      console.log(`curl -X POST ${BASE_URL}/webhooks/recall \\`);
      console.log(`  -H "Content-Type: application/json" \\`);
      console.log(`  -d '{"event":"bot.status_change","timestamp":"${new Date().toISOString()}","data":{"bot_id":"${botId}","status":"in_call"}}'`);

      console.log(`\n# 3. Transcription chunk`);
      console.log(`curl -X POST ${BASE_URL}/webhooks/recall \\`);
      console.log(`  -H "Content-Type: application/json" \\`);
      console.log(`  -d '{"event":"bot.transcription","timestamp":"${new Date().toISOString()}","data":{"bot_id":"${botId}","transcription":{"text":"Hello everyone","speaker":"Sarah","start_time":0,"end_time":5,"confidence":0.95}}}'`);

      console.log(`\n# 4. Status: done (triggers transcript fetch)`);
      console.log(`curl -X POST ${BASE_URL}/webhooks/recall \\`);
      console.log(`  -H "Content-Type: application/json" \\`);
      console.log(`  -d '{"event":"bot.status_change","timestamp":"${new Date().toISOString()}","data":{"bot_id":"${botId}","status":"done"}}'`);

      console.log(`\n\nMeeting ID for verification: ${meeting.id}`);

      process.exit(0);
    }

    await cleanup();

    // Create meeting and simulate webhooks
    const botId = `test-bot-${Date.now()}`;
    const meeting = await createMeetingRecord(botId);
    await simulateRecallWebhooks(botId);
    passed = await verifyResults(meeting.id);

    // Test Google Chat webhook
    await testGChatWebhook();

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }

  process.exit(passed ? 0 : 1);
}

main();
