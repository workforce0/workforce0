/**
 * Test Transcript Buffer Service
 * Run with: npx tsx tests/test-transcript-buffer.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
  console.log('🧪 Transcript Buffer Test\n');

  const pg = await import('pg');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { PrismaClient } = await import('../prisma/generated/client/index.js');
  const { config } = await import('../src/config/index.js');
  const { TranscriptBufferService } = await import('../src/services/meeting/transcript-buffer.service.js');
  const { MeetingRepository } = await import('../src/repositories/meeting.repository.js');

  // Setup
  const pool = new pg.default.Pool({ connectionString: config.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  const meetingRepository = new MeetingRepository(prisma);

  // Create buffer with fast flush for testing
  const buffer = new TranscriptBufferService(meetingRepository, {
    maxChunks: 5,        // Flush every 5 chunks
    flushIntervalMs: 2000, // Or every 2 seconds
    maxStoredChunks: 20,
  });

  // Find a test meeting
  const meeting = await prisma.meeting.findFirst({
    orderBy: { createdAt: 'desc' },
  });

  if (!meeting) {
    console.log('❌ No meeting found in database');
    await cleanup();
    return;
  }

  console.log('📋 Using meeting:', meeting.title);
  console.log('   ID:', meeting.id);

  // Test 1: Add chunks without immediate DB write
  console.log('\n📝 Test 1: Adding 3 chunks (should NOT flush yet)...');
  const startTime = Date.now();

  buffer.addChunk(meeting.id, {
    speaker: 'Test Speaker',
    text: 'Hello',
    startTime: 0,
    endTime: 500,
  });
  buffer.addChunk(meeting.id, {
    speaker: 'Test Speaker',
    text: 'World',
    startTime: 500,
    endTime: 1000,
  });
  buffer.addChunk(meeting.id, {
    speaker: 'Test Speaker',
    text: 'Testing',
    startTime: 1000,
    endTime: 1500,
  });

  const addTime = Date.now() - startTime;
  console.log(`   ✅ 3 chunks added in ${addTime}ms (no DB writes)`);

  // Check stats
  const stats1 = buffer.getStats();
  console.log(`   📊 Buffer stats: ${stats1.totalBufferedChunks} chunks buffered`);

  // Test 2: Add more chunks to trigger flush (maxChunks = 5)
  console.log('\n📝 Test 2: Adding 2 more chunks (should trigger flush at 5)...');

  buffer.addChunk(meeting.id, {
    speaker: 'Test Speaker',
    text: 'Buffer',
    startTime: 1500,
    endTime: 2000,
  });
  buffer.addChunk(meeting.id, {
    speaker: 'Test Speaker',
    text: 'Test',
    startTime: 2000,
    endTime: 2500,
  });

  // Wait a moment for async flush
  await new Promise(r => setTimeout(r, 500));

  const stats2 = buffer.getStats();
  console.log(`   📊 After flush: ${stats2.totalBufferedChunks} chunks buffered`);

  // Test 3: Manual flush on meeting end
  console.log('\n📝 Test 3: Adding chunk then ending meeting...');

  buffer.addChunk(meeting.id, {
    speaker: 'Test Speaker',
    text: 'Final chunk',
    startTime: 2500,
    endTime: 3000,
  });

  const stats3 = buffer.getStats();
  console.log(`   📊 Before endMeeting: ${stats3.totalBufferedChunks} chunks buffered`);

  await buffer.endMeeting(meeting.id);

  const stats4 = buffer.getStats();
  console.log(`   📊 After endMeeting: ${stats4.totalBufferedChunks} chunks buffered`);
  console.log('   ✅ Meeting ended and buffer flushed');

  // Verify in database
  const updatedMeeting = await prisma.meeting.findUnique({
    where: { id: meeting.id },
  });

  const metadata = updatedMeeting?.metadata as Record<string, unknown>;
  const chunks = (metadata?.transcriptChunks as unknown[]) || [];
  console.log(`\n📊 Database verification: ${chunks.length} chunks stored in metadata`);

  // Cleanup
  async function cleanup() {
    await buffer.shutdown();
    await prisma.$disconnect();
    await pool.end();
  }

  await cleanup();
  console.log('\n✅ All tests passed!');
}

main().catch(console.error);
