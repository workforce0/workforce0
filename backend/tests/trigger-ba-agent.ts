/**
 * Manually trigger BA Agent to generate PRD from a meeting transcript.
 */

import { PrismaClient } from '../prisma/generated/client/index.js';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { BAAgentService } from '../src/services/agent/ba-agent.service.js';
import { TaskRepository } from '../src/repositories/task.repository.js';
import { PRDRepository } from '../src/repositories/prd.repository.js';
import { MeetingRepository } from '../src/repositories/meeting.repository.js';
import { GeminiService } from '../src/services/ai/gemini.service.js';
import { JiraService } from '../src/services/integrations/jira.service.js';
import { GoogleChatService } from '../src/services/integrations/gchat.service.js';
import { AICouncil } from '../src/services/ai/ai-council.js';
import { OpenAIService } from '../src/services/ai/openai.service.js';
import { GoogleDocsService } from '../src/services/integrations/gdocs.service.js';
import { config } from '../src/config/index.js';
import { v4 as uuidv4 } from 'uuid';

const DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/workforce0';

async function main() {
  const meetingId = 'cmkvry2zb00000wvjbmcut7k0';
  const tenantId = 'test-tenant-real';

  console.log('🚀 Triggering BA Agent for PRD generation...\n');

  // Connect to database
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // Get the meeting with transcript
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { transcript: true },
    });

    if (!meeting) {
      console.error('❌ Meeting not found');
      return;
    }

    if (!meeting.transcript?.fullText) {
      console.error('❌ No transcript found for meeting');
      return;
    }

    console.log(`📋 Meeting: ${meeting.title}`);
    console.log(`📝 Transcript: ${meeting.transcript.wordCount} words`);
    console.log(`\n📜 Transcript text:\n"${meeting.transcript.fullText}"\n`);

    // Initialize services
    const taskRepository = new TaskRepository(prisma);
    const prdRepository = new PRDRepository(prisma);
    const meetingRepository = new MeetingRepository(prisma);
    const geminiService = new GeminiService(config.GEMINI_API_KEY);
    const openaiService = new OpenAIService(config.OPENAI_API_KEY);
    const aiCouncil = new AICouncil(geminiService, openaiService);
    const jiraService = new JiraService({
      baseUrl: config.JIRA_BASE_URL,
      email: config.JIRA_EMAIL,
      apiToken: config.JIRA_API_TOKEN,
    });
    const googleChatService = new GoogleChatService({
      webhookUrl: config.GCHAT_WEBHOOK_URL,
    });
    const googleDocsCredentials = config.GOOGLE_SERVICE_ACCOUNT_KEY
      ? JSON.parse(config.GOOGLE_SERVICE_ACCOUNT_KEY)
      : undefined;
    const googleDocsService = new GoogleDocsService({
      credentials: googleDocsCredentials,
      defaultFolderId: config.GOOGLE_DRIVE_FOLDER_ID,
    });

    const baAgentService = new BAAgentService(
      taskRepository,
      prdRepository,
      meetingRepository,
      geminiService,
      jiraService,
      googleChatService,
      aiCouncil,
      googleDocsService
    );

    // Create a task for tracking
    const taskId = uuidv4();
    console.log(`\n🔧 Creating task: ${taskId}`);

    await prisma.agentTask.create({
      data: {
        id: taskId,
        tenantId,
        meetingId,
        agentType: 'ba-agent',
        status: 'processing',
        input: { meetingId, transcript: meeting.transcript.fullText },
      },
    });

    console.log('\n🤖 Running BA Agent...\n');

    // Run BA Agent
    const result = await baAgentService.processMeetingTranscript(
      taskId,
      tenantId,
      meetingId,
      meeting.transcript.fullText
    );

    console.log('\n✅ BA Agent completed!');
    console.log(`   PRD ID: ${result.prd?.id}`);
    console.log(`   PRD Title: ${result.prd?.title}`);
    console.log(`   Task ID: ${result.taskId}`);
    console.log(`   Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    console.log(`   Council Decision: ${result.councilDecision || 'N/A'}`);
    console.log(`   Revision Iterations: ${result.revisionIterations ?? 0}`);

    // Fetch the generated PRD for detailed info
    const prd = result.prd?.id ? await prisma.pRD.findUnique({
      where: { id: result.prd.id },
    }) : null;

    if (prd) {
      console.log('\n📄 Generated PRD:');
      console.log(`   Title: ${prd.title}`);
      console.log(`   Version: ${prd.version}`);
      console.log(`   Status: ${prd.status}`);

      // Pretty print the content
      const content = prd.content as Record<string, unknown>;
      if (content?.overview) {
        console.log(`\n📋 Overview:`);
        console.log(`   ${(content.overview as string).substring(0, 200)}...`);
      }

      if (content?.requirements && Array.isArray(content.requirements)) {
        console.log(`\n📌 Requirements (${content.requirements.length} total):`);
        for (const req of content.requirements.slice(0, 5)) {
          const r = req as { title?: string; priority?: string };
          console.log(`   - [${r.priority || 'N/A'}] ${r.title || 'Untitled'}`);
        }
        if (content.requirements.length > 5) {
          console.log(`   ... and ${content.requirements.length - 5} more`);
        }
      }

      if (prd.googleDocId) {
        console.log(`\n📝 Google Doc: https://docs.google.com/document/d/${prd.googleDocId}/edit`);
      }
    }

  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch(console.error);
