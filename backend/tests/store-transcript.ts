/**
 * Manually fetch and store transcript for a meeting.
 */

import { PrismaClient } from '../prisma/generated/client/index.js';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const RECALL_API_KEY = '180cb117338b22a2a33c58ac79f6d5d007b25401';
const API_BASE = 'https://us-west-2.recall.ai/api/v1';
const DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/workforce0';

interface TranscriptSegment {
  speaker: string;
  text: string;
  startTime: number;
  endTime: number;
  confidence: number;
}

async function fetchTranscript(botId: string) {
  console.log(`\n📥 Fetching transcript for bot: ${botId}`);

  const botResponse = await fetch(`${API_BASE}/bot/${botId}`, {
    headers: { 'Authorization': `Token ${RECALL_API_KEY}` },
  });

  if (!botResponse.ok) {
    console.error(`❌ Failed to get bot: ${botResponse.status}`);
    return null;
  }

  const botDetails = await botResponse.json();
  const recording = botDetails.recordings?.[0];
  const transcriptInfo = recording?.media_shortcuts?.transcript;

  if (!transcriptInfo || transcriptInfo.status?.code !== 'done') {
    console.error('❌ Transcript not ready');
    return null;
  }

  const downloadUrl = transcriptInfo.data?.download_url;
  if (!downloadUrl) {
    console.error('❌ No download URL');
    return null;
  }

  const transcriptResponse = await fetch(downloadUrl);
  const transcriptJson = await transcriptResponse.json() as Array<{
    words: Array<{
      text: string;
      start_timestamp: number;
      end_timestamp: number;
      confidence?: number;
    }>;
    speaker: string;
  }>;

  const segments: TranscriptSegment[] = [];
  let totalWords = 0;

  for (const segment of transcriptJson) {
    if (!segment.words || segment.words.length === 0) continue;

    const text = segment.words.map(w => w.text).join(' ');
    const startTime = segment.words[0].start_timestamp || 0;
    const endTime = segment.words[segment.words.length - 1].end_timestamp || 0;

    segments.push({
      speaker: segment.speaker || 'Unknown',
      text,
      startTime,
      endTime,
      confidence: 1,
    });

    totalWords += segment.words.length;
  }

  const fullText = segments.map((s) => s.text).join(' ');

  console.log(`✅ Fetched ${segments.length} segments, ${totalWords} words`);

  return { segments, fullText, wordCount: totalWords, duration: 0 };
}

async function main() {
  const meetingId = 'cmkvry2zb00000wvjbmcut7k0';
  const botId = '99ae8dac-3063-45a4-91e2-1608ef1f434f';

  // Connect to database
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // Fetch transcript from Recall.ai
    const transcriptData = await fetchTranscript(botId);
    if (!transcriptData) {
      console.error('❌ Failed to fetch transcript');
      return;
    }

    // Check if transcript already exists
    const existing = await prisma.transcript.findUnique({
      where: { meetingId },
    });

    if (existing) {
      console.log('ℹ️ Transcript already exists, updating...');
      await prisma.transcript.update({
        where: { meetingId },
        data: {
          segments: JSON.parse(JSON.stringify(transcriptData.segments)),
          fullText: transcriptData.fullText,
          wordCount: transcriptData.wordCount,
          duration: transcriptData.duration,
          speakers: JSON.parse(JSON.stringify([...new Set(transcriptData.segments.map(s => s.speaker))])),
        },
      });
    } else {
      console.log('📝 Creating new transcript record...');
      await prisma.transcript.create({
        data: {
          meetingId,
          segments: JSON.parse(JSON.stringify(transcriptData.segments)),
          fullText: transcriptData.fullText,
          wordCount: transcriptData.wordCount,
          duration: transcriptData.duration,
          speakers: JSON.parse(JSON.stringify([...new Set(transcriptData.segments.map(s => s.speaker))])),
        },
      });
    }

    console.log('✅ Transcript stored in database!');

    // Verify
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { transcript: true },
    });

    console.log('\n📋 Meeting with transcript:');
    console.log(`   ID: ${meeting?.id}`);
    console.log(`   Status: ${meeting?.status}`);
    console.log(`   Transcript: ${meeting?.transcript ? 'YES' : 'NO'}`);
    if (meeting?.transcript) {
      console.log(`   Words: ${meeting.transcript.wordCount}`);
      console.log(`   Preview: "${meeting.transcript.fullText?.substring(0, 100)}..."`);
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch(console.error);
