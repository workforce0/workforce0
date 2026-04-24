/**
 * Direct BA Agent test - bypasses queue for quick testing
 * Run with: npx tsx tests/test-ba-agent-direct.ts
 */

// Load env FIRST before any imports that might use config
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
  console.log('🚀 Direct BA Agent Test\n');

  // Dynamic imports AFTER dotenv is loaded
  const pg = await import('pg');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { PrismaClient } = await import('../prisma/generated/client/index.js');
  const { config } = await import('../src/config/index.js');
  const { BAAgentService } = await import('../src/services/agent/ba-agent.service.js');
  const { GeminiService } = await import('../src/services/ai/gemini.service.js');
  const { OpenAIService } = await import('../src/services/ai/openai.service.js');
  const { AICouncil } = await import('../src/services/ai/ai-council.js');
  const { PRDRepository } = await import('../src/repositories/prd.repository.js');
  const { TaskRepository } = await import('../src/repositories/task.repository.js');

  // Setup Prisma
  const pool = new pg.default.Pool({ connectionString: config.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  // Get the meeting with transcript
  const meeting = await prisma.meeting.findFirst({
    where: { title: { contains: 'Vikram' } },
    include: { transcript: true },
  });

  if (!meeting || !meeting.transcript) {
    console.error('❌ Meeting with transcript not found');
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  console.log('📋 Meeting:', meeting.title);
  console.log('📄 Transcript length:', meeting.transcript.fullText.length, 'chars\n');

  console.log('🔧 Initializing services...');

  const geminiService = new GeminiService(config.GEMINI_API_KEY);
  const openaiService = new OpenAIService(config.OPENAI_API_KEY);
  const aiCouncil = new AICouncil(geminiService, openaiService);
  const prdRepository = new PRDRepository(prisma);
  const taskRepository = new TaskRepository(prisma);
  const { MeetingRepository } = await import('../src/repositories/meeting.repository.js');
  const meetingRepository = new MeetingRepository(prisma);

  // Constructor order: taskRepo, prdRepo, meetingRepo, geminiService, jiraService, gchatService, aiCouncil, googleDocsService
  const baAgent = new BAAgentService(
    taskRepository,
    prdRepository,
    meetingRepository,
    geminiService,
    null, // jiraService
    null, // googleChatService
    aiCouncil,
    null  // googleDocsService
  );

  console.log('✅ Services initialized');
  console.log('🤖 Processing transcript with AI Council...\n');
  console.log('=' .repeat(60));

  const startTime = Date.now();

  try {
    const result = await baAgent.processMeetingTranscript(
      undefined, // taskId - let it create one
      meeting.tenantId,
      meeting.id,
      meeting.transcript.fullText
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('=' .repeat(60));
    console.log(`\n✅ Processing complete in ${duration}s\n`);

    if (result.prd) {
      console.log('📋 PRD Generated:');
      console.log('   ID:', result.prd.id);
      console.log('   Title:', result.prd.title);
      console.log('   Status:', result.prd.status);
      console.log('   Confidence:', (result.prd.confidenceScore * 100).toFixed(0) + '%');
      console.log('\n📝 Summary:');
      console.log(result.prd.summary);
      console.log('\n📊 Requirements count:',
        typeof result.prd.requirements === 'object'
          ? Object.keys(result.prd.requirements as object).length
          : 'N/A'
      );

      if (result.googleDocsUrl) {
        console.log('\n📄 Google Docs:', result.googleDocsUrl);
      }
    }

    if (result.needsClarification && result.clarificationRequest) {
      console.log('\n❓ Clarification needed:');
      console.log('   Question:', result.clarificationRequest.question);
    }

  } catch (error) {
    console.error('\n❌ Error:', (error as Error).message);
    console.error((error as Error).stack);
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
