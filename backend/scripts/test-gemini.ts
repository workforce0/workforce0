/**
 * Test script for Gemini PRD generation
 *
 * Run with: npx tsx scripts/test-gemini.ts
 */

import { GeminiService } from '../src/services/ai/gemini.service.js';
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
  console.log('🧪 Testing Gemini PRD Generation\n');
  console.log('='.repeat(60));

  // Initialize service
  const gemini = new GeminiService(config.GEMINI_API_KEY);

  // Test connection
  console.log('\n📡 Testing Gemini API connection...');
  const connected = await gemini.testConnection();

  if (!connected) {
    console.error('❌ Failed to connect to Gemini API');
    console.error('   Check your GEMINI_API_KEY in .env');
    process.exit(1);
  }
  console.log('✅ Connected to Gemini API\n');

  // Generate PRD
  console.log('📝 Generating PRD from sample transcript...');
  console.log('   (This may take 10-30 seconds)\n');

  const startTime = Date.now();

  try {
    const prd = await gemini.generatePRD(SAMPLE_TRANSCRIPT, {
      additionalContext: 'Mobile app for consumer users. React Native frontend.',
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('='.repeat(60));
    console.log('✅ PRD Generated Successfully!');
    console.log(`   Time: ${elapsed}s`);
    console.log(`   Confidence: ${(prd.confidence * 100).toFixed(0)}%`);
    console.log('='.repeat(60));

    // Display PRD summary
    console.log('\n📋 PRD SUMMARY');
    console.log('-'.repeat(40));
    console.log(`Title: ${prd.title}`);
    console.log(`\nSummary:\n${prd.summary}`);

    console.log('\n🎯 OBJECTIVES');
    console.log('-'.repeat(40));
    prd.objectives.forEach((obj, i) => {
      console.log(`${i + 1}. ${obj}`);
    });

    console.log('\n📦 REQUIREMENTS');
    console.log('-'.repeat(40));
    prd.requirements.forEach((req, i) => {
      console.log(`\n${i + 1}. [${req.priority.toUpperCase()}] ${req.title}`);
      console.log(`   Type: ${req.type}`);
      console.log(`   ${req.description.substring(0, 200)}...`);
      if (req.estimatedEffort) {
        console.log(`   Effort: ${req.estimatedEffort}`);
      }
    });

    console.log('\n⚠️  RISKS');
    console.log('-'.repeat(40));
    prd.risks.forEach((risk, i) => {
      console.log(`${i + 1}. ${risk.description}`);
      console.log(`   Impact: ${risk.impact}`);
      if (risk.mitigation) {
        console.log(`   Mitigation: ${risk.mitigation}`);
      }
    });

    console.log('\n🚫 OUT OF SCOPE');
    console.log('-'.repeat(40));
    prd.outOfScope.forEach((item, i) => {
      console.log(`${i + 1}. ${item}`);
    });

    if (prd.reasoning) {
      console.log('\n💭 AI REASONING');
      console.log('-'.repeat(40));
      console.log(prd.reasoning);
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎉 Test complete! The Gemini PRD generation is working.');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ PRD generation failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);
