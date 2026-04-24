/**
 * Direct Gemini Live API Test
 *
 * Tests the raw WebSocket connection to diagnose connection issues.
 * Run with: npx tsx tests/test-gemini-live-direct.ts
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main() {
  console.log('🔌 Direct Gemini Live API Test\n');
  console.log('='.repeat(60));

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    console.error('❌ GEMINI_API_KEY not set');
    process.exit(1);
  }

  console.log('✅ API Key configured (starts with:', API_KEY.substring(0, 10) + '...)');

  // Test both v1alpha and v1beta endpoints
  const endpoints = [
    { name: 'v1beta', url: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_KEY}` },
    { name: 'v1alpha', url: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${API_KEY}` },
  ];

  for (const endpoint of endpoints) {
    console.log(`\n📡 Testing ${endpoint.name} endpoint...`);
    await testEndpoint(endpoint.name, endpoint.url);
  }
}

function testEndpoint(name: string, url: string): Promise<void> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let setupSent = false;
    let receivedMessages: string[] = [];

    const timeout = setTimeout(() => {
      console.log(`  ⏱️  Timeout after 10 seconds`);
      ws.close();
      resolve();
    }, 10000);

    ws.on('open', () => {
      console.log('  ✅ WebSocket connected');

      // Send setup message matching the GeminiLiveClient format
      // Note: gemini-2.0-flash-live-001 was deprecated Dec 2025
      const setup = {
        setup: {
          model: 'models/gemini-2.5-flash-native-audio-preview-12-2025',
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: 'Kore',
                },
              },
            },
          },
          systemInstruction: {
            parts: [{ text: 'You are a helpful meeting assistant. Keep responses brief.' }],
          },
          tools: [{
            functionDeclarations: [{
              name: 'flag_ambiguity',
              description: 'Flag a requirement that needs clarification.',
              parameters: {
                type: 'object',
                properties: {
                  requirement: { type: 'string', description: 'The ambiguous requirement' },
                  question: { type: 'string', description: 'The clarifying question' },
                },
                required: ['requirement', 'question'],
              },
            }],
          }],
          // Note: realtimeInputConfig removed as field names may not be supported
          // The API uses automatic activity detection by default
        },
      };

      console.log('  📤 Sending setup:', JSON.stringify(setup, null, 2).substring(0, 200) + '...');
      ws.send(JSON.stringify(setup));
      setupSent = true;
    });

    ws.on('message', (data) => {
      const message = data.toString();
      receivedMessages.push(message);

      try {
        const parsed = JSON.parse(message);
        console.log('  📥 Received:', JSON.stringify(parsed, null, 2).substring(0, 500));

        if (parsed.setupComplete) {
          console.log('  🎉 Setup complete! Session ID:', parsed.setupComplete.sessionId);
        }
        if (parsed.error) {
          console.log('  ❌ Error from API:', parsed.error);
        }
      } catch (e) {
        console.log('  📥 Received (raw):', message.substring(0, 200));
      }
    });

    ws.on('error', (error) => {
      console.log('  ❌ WebSocket error:', error.message);
    });

    ws.on('close', (code, reason) => {
      clearTimeout(timeout);
      console.log(`  🔴 WebSocket closed - Code: ${code}, Reason: "${reason.toString()}"`);

      // Interpret close codes
      const codeDescriptions: Record<number, string> = {
        1000: 'Normal closure',
        1001: 'Going away',
        1002: 'Protocol error',
        1003: 'Unsupported data',
        1006: 'Abnormal closure (no close frame)',
        1007: 'Invalid payload',
        1008: 'Policy violation',
        1009: 'Message too big',
        1010: 'Extension required',
        1011: 'Internal server error',
        1015: 'TLS handshake failure',
      };

      if (codeDescriptions[code]) {
        console.log(`  📋 Close code meaning: ${codeDescriptions[code]}`);
      }

      if (receivedMessages.length === 0 && setupSent) {
        console.log('  ⚠️  No messages received before close - likely API access issue');
        console.log('     Possible causes:');
        console.log('     - API key may not have Gemini Live API access');
        console.log('     - Model may not be available in your region');
        console.log('     - Check https://ai.google.dev/pricing for Live API access');
      }

      resolve();
    });
  });
}

main().catch(console.error);
