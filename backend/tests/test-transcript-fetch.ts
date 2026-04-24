/**
 * Test transcript fetching with the new Recall.ai API format.
 */

const RECALL_API_KEY = '180cb117338b22a2a33c58ac79f6d5d007b25401';
const API_BASE = 'https://us-west-2.recall.ai/api/v1';

interface TranscriptSegment {
  speaker: string;
  text: string;
  startTime: number;
  endTime: number;
  confidence: number;
}

async function getTranscript(botId: string) {
  console.log(`\n📥 Fetching bot details for: ${botId}`);

  // Step 1: Get bot details
  const botResponse = await fetch(`${API_BASE}/bot/${botId}`, {
    headers: { 'Authorization': `Token ${RECALL_API_KEY}` },
  });

  if (!botResponse.ok) {
    console.error(`❌ Failed to get bot: ${botResponse.status}`);
    return null;
  }

  const botDetails = await botResponse.json();
  const lastStatusChange = botDetails.status_changes?.[botDetails.status_changes.length - 1];
  console.log(`✅ Bot status: ${lastStatusChange?.code}`);
  console.log(`   Recordings: ${botDetails.recordings?.length || 0}`);

  // Step 2: Find transcript in recordings
  const recording = botDetails.recordings?.[0];
  if (!recording) {
    console.error('❌ No recordings found');
    return null;
  }

  console.log(`\n📹 Recording: ${recording.id}`);
  console.log(`   Status: ${recording.status?.code}`);

  const transcriptInfo = recording.media_shortcuts?.transcript;
  if (!transcriptInfo) {
    console.error('❌ No transcript info in recording');
    console.log('   Available media_shortcuts:', Object.keys(recording.media_shortcuts || {}));
    return null;
  }

  console.log(`\n📝 Transcript info:`);
  console.log(`   ID: ${transcriptInfo.id}`);
  console.log(`   Status: ${transcriptInfo.status?.code}`);

  if (transcriptInfo.status?.code !== 'done') {
    console.error('❌ Transcript not ready yet');
    return null;
  }

  const downloadUrl = transcriptInfo.data?.download_url;
  if (!downloadUrl) {
    console.error('❌ No download URL');
    return null;
  }

  console.log(`   Download URL: ${downloadUrl.substring(0, 80)}...`);

  // Step 3: Download transcript JSON
  console.log('\n📥 Downloading transcript...');
  const transcriptResponse = await fetch(downloadUrl);
  if (!transcriptResponse.ok) {
    console.error(`❌ Failed to download: ${transcriptResponse.status}`);
    return null;
  }

  const transcriptJson = await transcriptResponse.json() as Array<{
    words: Array<{
      text: string;
      start_timestamp: number;
      end_timestamp: number;
      confidence?: number;
    }>;
    speaker: string;
    speaker_id?: number;
    language?: string;
  }>;

  console.log(`✅ Downloaded ${transcriptJson.length} segments`);

  // Step 4: Process segments
  const segments: TranscriptSegment[] = [];
  let totalWords = 0;

  for (const segment of transcriptJson) {
    if (!segment.words || segment.words.length === 0) continue;

    const text = segment.words.map(w => w.text).join(' ');
    const startTime = segment.words[0].start_timestamp;
    const endTime = segment.words[segment.words.length - 1].end_timestamp;
    const avgConfidence = segment.words.reduce((sum, w) => sum + (w.confidence || 1), 0) / segment.words.length;

    segments.push({
      speaker: segment.speaker || 'Unknown',
      text,
      startTime,
      endTime,
      confidence: avgConfidence,
    });

    totalWords += segment.words.length;
  }

  const fullText = segments.map((s) => s.text).join(' ');

  console.log(`\n✅ Processed transcript:`);
  console.log(`   Segments: ${segments.length}`);
  console.log(`   Words: ${totalWords}`);
  console.log(`   Duration: ${segments.length > 0 ? segments[segments.length - 1].endTime - segments[0].startTime : 0}s`);

  console.log('\n📝 Transcript preview:');
  for (const seg of segments.slice(0, 5)) {
    console.log(`   [${seg.speaker}]: "${seg.text.substring(0, 80)}${seg.text.length > 80 ? '...' : ''}"`);
  }
  if (segments.length > 5) {
    console.log(`   ... and ${segments.length - 5} more segments`);
  }

  return { segments, fullText, wordCount: totalWords };
}

async function main() {
  // Test the specific bot from the latest meeting
  const specificBotId = '99ae8dac-3063-45a4-91e2-1608ef1f434f';
  console.log(`\n🔍 Testing specific bot: ${specificBotId}`);
  await getTranscript(specificBotId);
}

main().catch(console.error);
