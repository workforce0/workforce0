/**
 * Test AI Council directly
 * Run with: npx tsx tests/test-ai-council.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
  console.log('🚀 AI Council Direct Test\n');

  // Dynamic imports
  const pg = await import('pg');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { PrismaClient } = await import('../prisma/generated/client/index.js');
  const { config } = await import('../src/config/index.js');
  const { GeminiService } = await import('../src/services/ai/gemini.service.js');
  const { OpenAIService } = await import('../src/services/ai/openai.service.js');
  const { AICouncil } = await import('../src/services/ai/ai-council.js');

  // Setup Prisma
  const pool = new pg.default.Pool({ connectionString: config.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  // Get meeting with transcript
  const meeting = await prisma.meeting.findFirst({
    where: { title: { contains: 'Vikram' } },
    include: { transcript: true },
  });

  if (!meeting?.transcript) {
    console.error('❌ Meeting with transcript not found');
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  console.log('📋 Meeting:', meeting.title);
  console.log('📄 Transcript:', meeting.transcript.fullText.length, 'chars\n');

  // Initialize AI services
  console.log('🔧 Initializing AI Council...');
  const geminiService = new GeminiService(config.GEMINI_API_KEY);
  const openaiService = new OpenAIService(config.OPENAI_API_KEY);
  const aiCouncil = new AICouncil(geminiService, openaiService);

  console.log('✅ AI Council ready\n');
  console.log('=' .repeat(60));
  console.log('🤖 Generating PRD with consensus...\n');

  const startTime = Date.now();

  try {
    const result = await aiCouncil.generatePRDWithCouncil(
      meeting.transcript.fullText,
      { temperature: 0.3 }
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // Save full output to file
    const outputPath = path.resolve(__dirname, 'prd-output.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\n📁 Full output saved to: ${outputPath}\n`);

    console.log('=' .repeat(60));
    console.log(`\n✅ PRD generated in ${duration}s\n`);

    console.log('='.repeat(60));
    console.log('                    GENERATED PRD');
    console.log('='.repeat(60));

    const prd = result.prd;

    console.log('\n📋 TITLE:', prd.title);

    console.log('\n' + '─'.repeat(40));
    console.log('1. EXECUTIVE SUMMARY');
    console.log('─'.repeat(40));
    console.log(prd.executiveSummary.overview);

    if (prd.executiveSummary.valueProposition?.length) {
      console.log('\n📌 Value Proposition:');
      prd.executiveSummary.valueProposition.forEach(v => console.log(`   • ${v}`));
    }

    if (prd.executiveSummary.coreCapabilities?.length) {
      console.log('\n⚡ Core Capabilities:');
      prd.executiveSummary.coreCapabilities.forEach(c => console.log(`   • ${c}`));
    }

    console.log('\n' + '─'.repeat(40));
    console.log('2. PROBLEM STATEMENT');
    console.log('─'.repeat(40));
    console.log(prd.problemStatement.currentState);
    if (prd.problemStatement.problems?.length) {
      console.log('\n🔴 Problems:');
      prd.problemStatement.problems.forEach(p => console.log(`   • ${p}`));
    }

    console.log('\n' + '─'.repeat(40));
    console.log('3. GOALS & OBJECTIVES');
    console.log('─'.repeat(40));
    console.log('🎯 Vision:', prd.goals.vision);
    if (prd.goals.objectives?.length) {
      console.log('\n📊 Measurable Objectives:');
      prd.goals.objectives.forEach((obj, i) => {
        console.log(`   ${i + 1}. ${obj.objective}`);
        console.log(`      Metric: ${obj.metric} | Target: ${obj.target}`);
      });
    }

    console.log('\n' + '─'.repeat(40));
    console.log('4. USER STORIES (' + (prd.userStories?.length || 0) + ')');
    console.log('─'.repeat(40));
    prd.userStories?.slice(0, 5).forEach((story, i) => {
      const priorityIcon = story.priority === 'must-have' ? '🔴' : story.priority === 'should-have' ? '🟡' : '🟢';
      console.log(`\n   ${priorityIcon} [${story.id}] ${story.persona}`);
      console.log(`      ${story.story}`);
    });
    if ((prd.userStories?.length || 0) > 5) {
      console.log(`\n   ... and ${prd.userStories!.length - 5} more stories`);
    }

    console.log('\n' + '─'.repeat(40));
    console.log('5. FUNCTIONAL REQUIREMENTS (' + (prd.functionalRequirements?.length || 0) + ')');
    console.log('─'.repeat(40));
    prd.functionalRequirements?.slice(0, 5).forEach((req, i) => {
      const priorityIcon = req.priority === 'must-have' ? '🔴' : req.priority === 'should-have' ? '🟡' : '🟢';
      console.log(`\n   ${priorityIcon} [${req.id}] ${req.title}`);
      console.log(`      ${req.description.substring(0, 100)}...`);
    });
    if ((prd.functionalRequirements?.length || 0) > 5) {
      console.log(`\n   ... and ${prd.functionalRequirements!.length - 5} more requirements`);
    }

    console.log('\n' + '─'.repeat(40));
    console.log('6. SCOPE');
    console.log('─'.repeat(40));
    console.log('✅ In Scope:');
    prd.scope.inScope?.forEach(item => console.log(`   • ${item}`));
    console.log('\n❌ Out of Scope:');
    prd.scope.outOfScope?.forEach(item => console.log(`   • ${item}`));

    console.log('\n' + '─'.repeat(40));
    console.log('7. RISKS (' + (prd.risks?.length || 0) + ')');
    console.log('─'.repeat(40));
    prd.risks?.slice(0, 3).forEach(risk => {
      const impactIcon = risk.impact === 'high' ? '🔴' : risk.impact === 'medium' ? '🟡' : '🟢';
      console.log(`\n   ${impactIcon} ${risk.description}`);
      console.log(`      Impact: ${risk.impact} | Probability: ${risk.probability}`);
      console.log(`      Mitigation: ${risk.mitigation}`);
    });

    console.log('\n' + '─'.repeat(40));
    console.log('8. OPEN QUESTIONS (' + (prd.openQuestions?.length || 0) + ')');
    console.log('─'.repeat(40));
    prd.openQuestions?.forEach((q, i) => console.log(`   ${i + 1}. ${q}`));

    console.log('\n' + '='.repeat(60));
    console.log('                    COUNCIL DECISION');
    console.log('='.repeat(60));
    console.log('\n📈 PRD Confidence:', (prd.confidence * 100).toFixed(0) + '%');
    console.log('🤝 Council Confidence:', (result.confidence * 100).toFixed(0) + '%');
    console.log('✅ Decision:', result.decision);
    console.log('🔄 Consensus Reached:', result.consensusReached ? 'YES' : 'NO');
    console.log('📊 Iterations:', result.votes?.length || 0);

    if (result.critique) {
      console.log('\n🔍 CRITIQUE FROM OPENAI:');
      console.log('   Assessment:', result.critique.overallAssessment);
      console.log('   Confidence:', (result.critique.critiqueConfidence * 100).toFixed(0) + '%');
      console.log('   Issues Found:', result.critique.issues?.length || 0);
      if (result.critique.strengths?.length) {
        console.log('   Strengths:', result.critique.strengths.slice(0, 2).join('; '));
      }
    }

    console.log('\n💰 COST ESTIMATE:');
    console.log(`   Gemini: $${result.estimatedCost.gemini.toFixed(4)}`);
    console.log(`   OpenAI: $${result.estimatedCost.openai.toFixed(4)}`);
    console.log(`   Total:  $${result.estimatedCost.total.toFixed(4)}`);

    console.log('\n⏱️ TIMING:');
    console.log(`   Primary Generation: ${(result.timing.primaryGeneration / 1000).toFixed(1)}s`);
    console.log(`   Critique: ${(result.timing.critique / 1000).toFixed(1)}s`);
    if (result.timing.revision) {
      console.log(`   Revision: ${(result.timing.revision / 1000).toFixed(1)}s`);
    }
    console.log(`   Total: ${(result.timing.total / 1000).toFixed(1)}s`);

  } catch (error) {
    console.error('\n❌ Error:', (error as Error).message);
    console.error((error as Error).stack);
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch(console.error);
