/**
 * Test Voice Session Manager
 *
 * Tests the real-time voice conversation flow:
 * 1. VoiceSessionManager creation and initialization
 * 2. Session lifecycle (start/end)
 * 3. Transcript routing to Gemini
 * 4. Audio response routing back to meeting
 */

import { VoiceSessionManager } from '../src/voice/session-manager.js';

async function testVoiceSessionManager() {
  console.log('='.repeat(60));
  console.log('Testing VoiceSessionManager');
  console.log('='.repeat(60));

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY not set');
    process.exit(1);
  }

  // Test 1: Create manager without RecallService (offline mode)
  console.log('\n📋 Test 1: Create manager without RecallService...');
  const manager = new VoiceSessionManager({
    geminiApiKey: GEMINI_API_KEY,
    recallService: null,
    activeParticipation: true,
  });
  console.log('✅ Manager created successfully');

  // Test 2: Check no active sessions initially
  console.log('\n📋 Test 2: Check no active sessions initially...');
  const activeSessions = manager.getActiveSessions();
  console.log(`Active sessions: ${activeSessions.length}`);
  if (activeSessions.length === 0) {
    console.log('✅ No active sessions initially');
  } else {
    console.log('❌ Expected 0 active sessions');
  }

  // Test 3: Check hasSession returns false for unknown meeting
  console.log('\n📋 Test 3: Check hasSession returns false...');
  const hasSession = manager.hasSession('unknown-meeting-123');
  console.log(`hasSession('unknown-meeting-123'): ${hasSession}`);
  if (!hasSession) {
    console.log('✅ hasSession returns false for unknown meeting');
  } else {
    console.log('❌ Expected false for unknown meeting');
  }

  // Test 4: Start a voice session (will connect to Gemini)
  console.log('\n📋 Test 4: Start voice session...');
  const meetingId = 'test-meeting-' + Date.now();
  const botId = 'test-bot-' + Date.now();

  try {
    // Set up event listeners before starting
    manager.on('sessionStarted', (mId, sessionId) => {
      console.log(`  📢 Event: sessionStarted - meeting=${mId}, session=${sessionId}`);
    });

    manager.on('sessionError', (mId, error) => {
      console.log(`  📢 Event: sessionError - meeting=${mId}, error=${error.message}`);
    });

    manager.on('sessionEnded', (mId, summary) => {
      console.log(`  📢 Event: sessionEnded - meeting=${mId}`);
      console.log(`    Requirements: ${summary.requirements.length}`);
      console.log(`    Action Items: ${summary.actionItems.length}`);
    });

    console.log(`  Starting session for meeting: ${meetingId}`);
    await manager.startSession(meetingId, botId);
    console.log('✅ Session started successfully');

    // Verify session exists
    if (manager.hasSession(meetingId)) {
      console.log('✅ hasSession returns true after start');
    } else {
      console.log('❌ hasSession should return true after start');
    }

    // Check active sessions
    const active = manager.getActiveSessions();
    console.log(`  Active sessions: ${active.length}`);
    if (active.includes(meetingId)) {
      console.log('✅ Meeting ID in active sessions');
    }

  } catch (error) {
    console.log(`⚠️  Session start failed (expected if Gemini Live API not accessible): ${(error as Error).message}`);
  }

  // Test 5: Send transcript chunk (if session active)
  if (manager.hasSession(meetingId)) {
    console.log('\n📋 Test 5: Send transcript chunk...');
    manager.handleTranscriptChunk(meetingId, {
      speaker: 'John',
      text: 'We need a mobile app for tracking expenses',
      startTime: 0,
      endTime: 3000,
    });
    console.log('✅ Transcript chunk sent');

    // Wait a moment for processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Send another chunk
    manager.handleTranscriptChunk(meetingId, {
      speaker: 'Sarah',
      text: 'It should sync with our accounting system',
      startTime: 3000,
      endTime: 6000,
    });
    console.log('✅ Second transcript chunk sent');

    // Get session stats
    const stats = manager.getSessionStats(meetingId);
    if (stats) {
      console.log('  Session stats:');
      console.log(`    Session ID: ${stats.sessionId}`);
      console.log(`    Bot ID: ${stats.botId}`);
      console.log(`    Started: ${stats.startedAt.toISOString()}`);
    }
  }

  // Test 6: End session
  if (manager.hasSession(meetingId)) {
    console.log('\n📋 Test 6: End voice session...');
    try {
      const summary = await manager.endSession(meetingId);
      console.log('✅ Session ended successfully');
      if (summary) {
        console.log('  Summary:');
        console.log(`    Duration: ${summary.duration}ms`);
        console.log(`    Requirements: ${summary.requirements.length}`);
        console.log(`    Action Items: ${summary.actionItems.length}`);
        console.log(`    Ambiguities: ${summary.ambiguities.length}`);
        console.log(`    AI Interactions: ${summary.aiInteractionCount}`);
      }

      // Verify session removed
      if (!manager.hasSession(meetingId)) {
        console.log('✅ Session removed after end');
      } else {
        console.log('❌ Session should be removed after end');
      }

    } catch (error) {
      console.log(`⚠️  End session failed: ${(error as Error).message}`);
    }
  }

  // Test 7: End non-existent session
  console.log('\n📋 Test 7: End non-existent session...');
  const nullSummary = await manager.endSession('non-existent-meeting');
  if (nullSummary === null) {
    console.log('✅ Returns null for non-existent session');
  } else {
    console.log('❌ Should return null for non-existent session');
  }

  // Test 8: End all sessions (graceful shutdown)
  console.log('\n📋 Test 8: End all sessions...');
  await manager.endAllSessions();
  console.log('✅ endAllSessions completed');

  console.log('\n' + '='.repeat(60));
  console.log('Voice Session Manager Tests Complete');
  console.log('='.repeat(60));
}

// Run tests
testVoiceSessionManager().catch(console.error);
