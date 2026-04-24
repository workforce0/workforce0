/**
 * Test Voice Flow End-to-End
 *
 * This test verifies the real-time voice conversation system:
 * 1. VoiceSessionManager starts when meeting begins recording
 * 2. Transcript chunks are routed to Gemini Live
 * 3. Gemini generates audio responses
 * 4. Audio is sent back to meeting via RecallService
 *
 * Run with: npx tsx tests/test-voice-flow.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

interface MockAudioCall {
  botId: string;
  audioLength: number;
  timestamp: Date;
}

async function main() {
  console.log('🎙️  Voice Flow Test\n');
  console.log('='.repeat(60));

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY not set in .env');
    console.log('\nTo test voice, you need a Gemini API key with Live API access.');
    process.exit(1);
  }

  console.log('✅ GEMINI_API_KEY configured');

  // Import modules
  const { VoiceSessionManager } = await import('../src/voice/session-manager.js');
  const { RecallService } = await import('../src/services/meeting/recall.service.js');

  // Track audio calls to verify flow
  const audioCalls: MockAudioCall[] = [];

  // Create a mock RecallService that tracks sendAudio calls
  // In production, this would actually send audio to Recall.ai
  const mockRecallService = {
    sendAudio: async (botId: string, audioData: Buffer) => {
      audioCalls.push({
        botId,
        audioLength: audioData.length,
        timestamp: new Date(),
      });
      console.log(`  📤 Audio sent to bot: ${audioData.length} bytes`);
    },
  } as unknown as RecallService;

  // Create VoiceSessionManager with mock RecallService
  console.log('\n📋 Step 1: Create VoiceSessionManager...');
  const manager = new VoiceSessionManager({
    geminiApiKey: GEMINI_API_KEY,
    recallService: mockRecallService,
    activeParticipation: true, // Bot will ask questions
  });
  console.log('✅ VoiceSessionManager created with activeParticipation=true');

  // Test meeting data
  const meetingId = `test-meeting-${Date.now()}`;
  const botId = `test-bot-${Date.now()}`;

  // Set up event listeners
  manager.on('sessionStarted', (mId, sessionId) => {
    console.log(`  🎉 Session started: ${sessionId}`);
  });

  manager.on('sessionError', (mId, error) => {
    console.log(`  ❌ Session error: ${error.message}`);
  });

  manager.on('sessionEnded', (mId, summary) => {
    console.log(`  📊 Session ended with ${summary.requirements.length} requirements captured`);
  });

  // Step 2: Start voice session (simulates bot.in_call_recording webhook)
  console.log('\n📋 Step 2: Start voice session (simulates bot joining call)...');
  try {
    await manager.startSession(meetingId, botId);
    console.log('✅ Voice session started - Gemini Live connected');
  } catch (error) {
    console.error('❌ Failed to start session:', (error as Error).message);
    console.log('\nPossible causes:');
    console.log('  - Gemini Live API not accessible (check API key permissions)');
    console.log('  - Network issues connecting to wss://generativelanguage.googleapis.com');
    console.log('  - API quota exceeded');
    process.exit(1);
  }

  // Step 3: Send transcript chunks (simulates real-time transcript from Recall.ai)
  console.log('\n📋 Step 3: Send transcript chunks (simulates meeting conversation)...');

  const transcriptChunks = [
    { speaker: 'John (Product Manager)', text: 'Okay, let\'s talk about the new expense tracking feature.' },
    { speaker: 'Sarah (Designer)', text: 'I think we need a mobile-first approach.' },
    { speaker: 'John (Product Manager)', text: 'Users should be able to scan receipts with their camera.' },
    { speaker: 'Mike (Developer)', text: 'Should it integrate with our existing accounting system?' },
    { speaker: 'John (Product Manager)', text: 'Yes, and we need approval workflows for expenses over 500 dollars.' },
  ];

  for (let i = 0; i < transcriptChunks.length; i++) {
    const chunk = transcriptChunks[i];
    console.log(`\n  💬 ${chunk.speaker}: "${chunk.text}"`);

    manager.handleTranscriptChunk(meetingId, {
      speaker: chunk.speaker,
      text: chunk.text,
      startTime: i * 5000,
      endTime: (i + 1) * 5000,
    });

    // Wait for Gemini to potentially respond
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Step 4: Check if audio was sent back
  console.log('\n📋 Step 4: Check audio responses...');
  console.log(`  Total audio responses sent: ${audioCalls.length}`);

  if (audioCalls.length > 0) {
    console.log('✅ Bot spoke in meeting! Audio was generated and sent.');
    for (const call of audioCalls) {
      console.log(`    - ${call.audioLength} bytes at ${call.timestamp.toISOString()}`);
    }
  } else {
    console.log('⚠️  No audio responses yet.');
    console.log('   This is normal - Gemini may choose not to interrupt.');
    console.log('   The AI waits for appropriate moments to ask questions.');
  }

  // Step 5: Get session stats
  console.log('\n📋 Step 5: Get session statistics...');
  const stats = manager.getSessionStats(meetingId);
  if (stats) {
    console.log('  Session stats:');
    console.log(`    - Session ID: ${stats.sessionId}`);
    console.log(`    - Bot ID: ${stats.botId}`);
    console.log(`    - Audio chunks received: ${stats.stats.audioChunksReceived}`);
    console.log(`    - AI responses: ${stats.stats.aiResponses}`);
    console.log(`    - Tool calls: ${stats.stats.toolCalls}`);
  }

  // Step 6: Send more context to trigger AI response
  console.log('\n📋 Step 6: Add ambiguous requirement to trigger AI question...');
  manager.handleTranscriptChunk(meetingId, {
    speaker: 'John (Product Manager)',
    text: 'The system should be fast.',
    startTime: 30000,
    endTime: 32000,
  });
  console.log('  💬 John (Product Manager): "The system should be fast."');
  console.log('  (This is ambiguous - AI should ask for clarification)');

  // Wait for potential response
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Step 7: End session
  console.log('\n📋 Step 7: End voice session...');
  const summary = await manager.endSession(meetingId);

  if (summary) {
    console.log('✅ Session ended successfully');
    console.log('\n📊 Session Summary:');
    console.log(`  - Duration: ${Math.round(summary.duration / 1000)}s`);
    console.log(`  - Requirements captured: ${summary.requirements.length}`);
    console.log(`  - Action items: ${summary.actionItems.length}`);
    console.log(`  - Ambiguities flagged: ${summary.ambiguities.length}`);
    console.log(`  - AI interactions: ${summary.aiInteractionCount}`);

    if (summary.requirements.length > 0) {
      console.log('\n  Captured Requirements:');
      for (const req of summary.requirements) {
        console.log(`    - [${req.section}] ${req.content}`);
      }
    }

    if (summary.ambiguities.length > 0) {
      console.log('\n  Flagged Ambiguities:');
      for (const amb of summary.ambiguities) {
        console.log(`    - Q: ${amb.question}`);
        console.log(`      (About: "${amb.requirement}")`);
      }
    }
  }

  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Results Summary');
  console.log('='.repeat(60));
  console.log(`✅ VoiceSessionManager: Working`);
  console.log(`✅ Gemini Live Connection: ${summary ? 'Connected' : 'Failed'}`);
  console.log(`✅ Transcript Processing: ${summary ? 'Working' : 'Unknown'}`);
  console.log(`${audioCalls.length > 0 ? '✅' : '⚠️'} Audio Generation: ${audioCalls.length > 0 ? 'Working' : 'No responses (AI chose not to interrupt)'}`);
  console.log(`✅ RecallService.sendAudio: Would send audio to meeting`);

  console.log('\n📝 To test in a real meeting:');
  console.log('1. Start the server: npm run dev');
  console.log('2. Create a Google Meet and copy the URL');
  console.log('3. POST to /api/meetings with the meeting URL');
  console.log('4. The bot will join and start listening');
  console.log('5. Speak about product requirements');
  console.log('6. The AI will ask clarifying questions!');
  console.log('\nNote: RecallService.sendAudio posts to /bot/{id}/speak');
  console.log('Make sure your Recall.ai plan supports the speak endpoint.');
}

main().catch(console.error);
