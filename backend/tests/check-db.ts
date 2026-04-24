import 'dotenv/config';
import { PrismaClient } from '../prisma/generated/client/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Checking database...\n');

  // Check meetings
  console.log('=== RECENT MEETINGS ===');
  const meetings = await prisma.meeting.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { transcript: true }
  });

  for (const m of meetings) {
    console.log(`\nMeeting: ${m.id}`);
    console.log(`  Title: ${m.title}`);
    console.log(`  Status: ${m.status}`);
    console.log(`  ExternalId: ${m.externalId || 'none'}`);
    console.log(`  Has Transcript: ${!!m.transcript}`);
    if (m.transcript) {
      console.log(`  Transcript words: ${m.transcript.wordCount}`);
      console.log(`  Transcript text: ${m.transcript.fullText?.substring(0, 200)}...`);
    }
    const meta = m.metadata as Record<string, unknown>;
    if (meta?.transcriptChunks) {
      console.log(`  Realtime chunks: ${(meta.transcriptChunks as unknown[]).length}`);
    }
    if (meta?.platform) {
      console.log(`  Platform: ${meta.platform}`);
    }
  }

  // Check tasks
  console.log('\n=== RECENT TASKS ===');
  const tasks = await prisma.agentTask.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });

  for (const t of tasks) {
    console.log(`\nTask: ${t.id}`);
    console.log(`  Type: ${t.agentType}`);
    console.log(`  Status: ${t.status}`);
    console.log(`  Meeting: ${t.meetingId || 'none'}`);
    console.log(`  Confidence: ${t.confidence}`);
  }

  // Check PRDs
  console.log('\n=== RECENT PRDs ===');
  const prds = await prisma.pRD.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3
  });

  for (const p of prds) {
    console.log(`\nPRD: ${p.id}`);
    console.log(`  Title: ${p.title}`);
    console.log(`  Status: ${p.status}`);
    console.log(`  Confidence: ${p.confidence}`);
    console.log(`  Summary: ${p.summary?.substring(0, 200)}...`);
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
