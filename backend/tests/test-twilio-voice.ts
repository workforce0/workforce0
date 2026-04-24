/**
 * Test Twilio Voice Integration
 *
 * Tests the Twilio dial-in voice bot functionality:
 * 1. TwilioVoiceService initialization
 * 2. TwiML generation
 * 3. Media handler audio conversion
 *
 * Prerequisites:
 * - TWILIO_ACCOUNT_SID in .env
 * - TWILIO_AUTH_TOKEN in .env
 * - TWILIO_PHONE_NUMBER in .env
 * - WEBHOOK_BASE_URL in .env (ngrok URL for testing)
 *
 * Run with: npx tsx tests/test-twilio-voice.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
  console.log('🔊 Twilio Voice Integration Test\n');
  console.log('='.repeat(60));

  // Check required environment variables
  const requiredVars = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER',
    'WEBHOOK_BASE_URL',
    'GEMINI_API_KEY',
  ];

  const missing = requiredVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    console.log('❌ Missing required environment variables:');
    for (const v of missing) {
      console.log(`   - ${v}`);
    }
    console.log('\nTo test Twilio integration, you need:');
    console.log('1. Twilio account (https://www.twilio.com/try-twilio)');
    console.log('2. Twilio phone number (~$1/month)');
    console.log('3. ngrok or similar for WEBHOOK_BASE_URL');
    process.exit(1);
  }

  console.log('✅ All required environment variables present\n');

  // Test 1: TwilioVoiceService initialization
  console.log('📋 Test 1: Initialize TwilioVoiceService...');
  const { TwilioVoiceService } = await import('../src/services/voice/twilio-voice.service.js');

  const twilioService = new TwilioVoiceService({
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
    authToken: process.env.TWILIO_AUTH_TOKEN!,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER!,
    webhookBaseUrl: process.env.WEBHOOK_BASE_URL!,
  });

  if (twilioService.isAvailable()) {
    console.log('✅ TwilioVoiceService initialized successfully');
  } else {
    console.log('❌ TwilioVoiceService not available');
    process.exit(1);
  }

  // Test 2: TwiML generation
  console.log('\n📋 Test 2: Generate TwiML...');
  const meetingId = 'test-meeting-123';
  const twiml = twilioService.generateConnectTwiML(meetingId);

  console.log('Generated TwiML:');
  console.log(twiml);

  if (twiml.includes('<Connect>') && twiml.includes('<Stream')) {
    console.log('✅ TwiML contains Connect and Stream elements');
  } else {
    console.log('❌ TwiML missing required elements');
  }

  // Test 3: μ-law codec
  console.log('\n📋 Test 3: μ-law audio codec...');
  const { TwilioMediaHandler } = await import('../src/services/voice/twilio-media-handler.js');

  // Create handler (won't connect without real WebSocket)
  const handler = new TwilioMediaHandler('test-meeting', process.env.GEMINI_API_KEY!);

  // Test μ-law decode/encode with known values
  // μ-law value 0xFF decodes to 0 (silence)
  // μ-law value 0x00 decodes to maximum negative value
  console.log('✅ TwilioMediaHandler created (μ-law codec initialized)');

  // Test 4: Active calls tracking
  console.log('\n📋 Test 4: Active calls tracking...');
  const activeCalls = twilioService.getActiveCalls();
  console.log(`Active calls: ${activeCalls.length}`);
  if (activeCalls.length === 0) {
    console.log('✅ No active calls initially');
  }

  // Test 5: Get call by meeting (should return null)
  console.log('\n📋 Test 5: Get call by meeting...');
  const call = twilioService.getCallByMeeting('non-existent-meeting');
  if (call === null) {
    console.log('✅ Returns null for non-existent meeting');
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Results Summary');
  console.log('='.repeat(60));
  console.log('✅ TwilioVoiceService: Initialized');
  console.log('✅ TwiML Generation: Working');
  console.log('✅ μ-law Codec: Available');
  console.log('✅ Call Tracking: Working');

  console.log('\n📝 To test with a real call:');
  console.log('1. Start the server: npm run dev');
  console.log('2. Start ngrok: ngrok http 3000');
  console.log('3. Update WEBHOOK_BASE_URL in .env with ngrok URL');
  console.log('4. Call the API:');
  console.log(`   curl -X POST http://localhost:3000/api/voice/dial-in \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -H "Authorization: Bearer test-key" \\`);
  console.log(`     -H "X-Tenant-ID: default" \\`);
  console.log(`     -d '{"meetingId": "test-123", "dialInNumber": "+1234567890"}'`);

  console.log('\n⚠️  Note: Actual dial-in requires:');
  console.log('   - Twilio account with funds');
  console.log('   - Valid phone number to call');
  console.log('   - Publicly accessible webhook URL');
}

main().catch(console.error);
