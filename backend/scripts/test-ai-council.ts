/**
 * Test script for AI Council - Multi-Model PRD Consensus
 *
 * Run with: npx tsx scripts/test-ai-council.ts
 *
 * This tests:
 * 1. Gemini generates PRD
 * 2. OpenAI critiques adversarially
 * 3. Consensus decision is made
 */

import { GeminiService } from '../src/services/ai/gemini.service.js';
import { OpenAIService } from '../src/services/ai/openai.service.js';
import { AICouncil } from '../src/services/ai/ai-council.js';
import { config } from '../src/config/index.js';

// Sample meeting transcript for testing
const SAMPLE_TRANSCRIPT = `
Meeting: Product Planning - User Authentication Feature
Date: January 25, 2026
Attendees: Sarah (PM), Mike (Tech Lead), Lisa (Designer)

Sarah: Alright team, let's discuss the authentication feature for our mobile app.
We've been getting a lot of requests from users who want to log in with their social accounts.

Mike: That makes sense. What social providers are we thinking?

Sarah: Definitely Google and Apple - those cover most of our user base.
We might add Facebook later but it's not a priority.

Lisa: From a UX perspective, I think we should have a clean login screen
with the social buttons prominently displayed, but also keep email/password as an option.

Mike: Agreed. We'll need to handle the OAuth flow properly.
For security, we should implement proper token storage and refresh token handling.

Sarah: How long do you think this will take?

Mike: For Google and Apple with proper security... I'd say about 2 sprints.
First sprint for the backend auth flow and token management.
Second sprint for the mobile UI and testing.

Sarah: That works. What about password reset for email users?

Mike: Good point. We'll need forgot password flow with email verification.
Should be part of sprint 1.

Lisa: I'll have the designs ready by end of week.
Should I include biometric login too - like Face ID?

Sarah: Yes! That's a must-have for the second sprint.
Users expect that these days.

Mike: Any concerns about rate limiting for login attempts?

Sarah: Definitely need that for security.
Block after 5 failed attempts for 15 minutes.

Mike: Got it. I'll also add audit logging for all auth events -
logins, logouts, password changes. Important for compliance.

Sarah: Perfect. Let's also make sure we handle account linking -
if someone signs up with email and later wants to connect their Google account.

Mike: That's a bit tricky but doable. We'll need to verify email ownership first.

Sarah: Sounds good. Let's target the feature for release in Q2.
`;

async function main() {
  console.log('🏛️  Testing AI Council - Multi-Model PRD Consensus\n');
  console.log('='.repeat(70));

  // Initialize services
  const gemini = new GeminiService(config.GEMINI_API_KEY);
  const openai = new OpenAIService(config.OPENAI_API_KEY);
  const council = new AICouncil(gemini, openai);

  // Show council status
  const status = council.getStatus();
  console.log('\n📊 Council Status:');
  console.log(`   Gemini: ${status.geminiEnabled ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`   OpenAI: ${status.openaiEnabled ? '✅ Enabled' : '⚠️  Disabled (no OPENAI_API_KEY)'}`);
  console.log(`   Critique: ${status.critiqueEnabled ? '✅ Enabled' : '⚠️  Disabled'}`);
  console.log(`   Consensus: ${status.consensusEnabled ? '✅ Enabled' : '⚠️  Disabled'}`);

  if (!status.openaiEnabled) {
    console.log('\n⚠️  OpenAI not configured. Add OPENAI_API_KEY to .env for full council.');
    console.log('   Running with Gemini-only mode...\n');
  }

  // Test connection
  console.log('\n📡 Testing API connections...');
  const geminiConnected = await gemini.testConnection();
  console.log(`   Gemini: ${geminiConnected ? '✅ Connected' : '❌ Failed'}`);

  if (status.openaiEnabled) {
    const openaiConnected = await openai.testConnection();
    console.log(`   OpenAI: ${openaiConnected ? '✅ Connected' : '❌ Failed'}`);
  }

  if (!geminiConnected) {
    console.error('\n❌ Gemini connection failed. Check GEMINI_API_KEY.');
    process.exit(1);
  }

  // Run council
  console.log('\n🏛️  Running AI Council...');
  console.log('   (This may take 30-60 seconds with full council)\n');

  const startTime = Date.now();

  try {
    const decision = await council.generatePRDWithCouncil(SAMPLE_TRANSCRIPT, {
      additionalContext: 'Mobile app for consumer users. React Native frontend.',
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Display results
    console.log('='.repeat(70));
    console.log('🏛️  COUNCIL DECISION');
    console.log('='.repeat(70));

    const decisionEmoji = {
      'approved': '✅',
      'needs_revision': '⚠️',
      'rejected': '❌',
      'needs_human_review': '👤',
    };

    console.log(`\nDecision: ${decisionEmoji[decision.decision]} ${decision.decision.toUpperCase()}`);
    console.log(`Confidence: ${(decision.confidence * 100).toFixed(0)}%`);
    console.log(`Time: ${elapsed}s`);

    // Timing breakdown
    console.log('\n⏱️  Timing Breakdown:');
    console.log(`   Primary Generation: ${(decision.timing.primaryGeneration / 1000).toFixed(1)}s`);
    if (decision.timing.critique > 0) {
      console.log(`   Critique: ${(decision.timing.critique / 1000).toFixed(1)}s`);
    }
    if (decision.timing.consensus > 0) {
      console.log(`   Consensus: ${(decision.timing.consensus / 1000).toFixed(1)}s`);
    }

    // Cost estimate
    console.log('\n💰 Estimated Cost:');
    console.log(`   Gemini: $${decision.estimatedCost.gemini.toFixed(4)}`);
    console.log(`   OpenAI: $${decision.estimatedCost.openai.toFixed(4)}`);
    console.log(`   Total:  $${decision.estimatedCost.total.toFixed(4)}`);

    // Votes
    console.log('\n🗳️  Model Votes:');
    decision.votes.forEach(vote => {
      const voteEmoji = vote.vote === 'approve' ? '✅' : vote.vote === 'reject' ? '❌' : '⚠️';
      console.log(`   ${vote.model}: ${voteEmoji} ${vote.vote} (${(vote.confidence * 100).toFixed(0)}%)`);
      if (vote.concerns.length > 0) {
        vote.concerns.slice(0, 2).forEach(c => {
          console.log(`      - ${c.substring(0, 80)}...`);
        });
      }
    });

    // Critique details (if available)
    if (decision.critique) {
      console.log('\n🔍 ADVERSARIAL CRITIQUE:');
      console.log('-'.repeat(50));
      console.log(`Assessment: ${decision.critique.overallAssessment}`);
      console.log(`Confidence: ${(decision.critique.critiqueConfidence * 100).toFixed(0)}%`);

      if (decision.critique.issues.length > 0) {
        console.log('\nIssues Found:');
        decision.critique.issues.forEach((issue, i) => {
          const severityEmoji = {
            'critical': '🔴',
            'major': '🟠',
            'minor': '🟡',
          };
          console.log(`${i + 1}. ${severityEmoji[issue.severity]} [${issue.severity.toUpperCase()}] ${issue.description}`);
          console.log(`   Section: ${issue.affectedSection}`);
          if (issue.suggestion) {
            console.log(`   Suggestion: ${issue.suggestion}`);
          }
        });
      }

      if (decision.critique.clarificationQuestions.length > 0) {
        console.log('\nClarification Questions:');
        decision.critique.clarificationQuestions.forEach((q, i) => {
          console.log(`${i + 1}. ${q}`);
        });
      }

      if (decision.critique.strengths.length > 0) {
        console.log('\nStrengths:');
        decision.critique.strengths.forEach((s, i) => {
          console.log(`${i + 1}. ✅ ${s}`);
        });
      }
    }

    // PRD Summary
    console.log('\n📋 PRD SUMMARY:');
    console.log('-'.repeat(50));
    console.log(`Title: ${decision.prd.title}`);
    console.log(`\nSummary:\n${decision.prd.summary}`);

    console.log('\n🎯 Objectives:');
    decision.prd.objectives.forEach((obj, i) => {
      console.log(`${i + 1}. ${obj}`);
    });

    console.log('\n📦 Requirements:');
    decision.prd.requirements.forEach((req, i) => {
      console.log(`${i + 1}. [${req.priority.toUpperCase()}] ${req.title}`);
    });

    // Outstanding issues
    if (decision.outstandingIssues.length > 0) {
      console.log('\n⚠️  Outstanding Issues to Address:');
      decision.outstandingIssues.forEach((issue, i) => {
        console.log(`${i + 1}. ${issue}`);
      });
    }

    console.log('\n' + '='.repeat(70));
    console.log('🎉 AI Council test complete!');
    console.log('='.repeat(70));

  } catch (error) {
    console.error('❌ Council failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);
