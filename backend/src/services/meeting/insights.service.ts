/**
 * Meeting Insights Service
 *
 * Generates AI-powered meeting summaries with decisions, action items,
 * sentiment analysis, and participant engagement metrics.
 */

import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'MeetingInsights' });

export interface InsightInput {
  meetingId: string;
  tenantId: string;
  transcript: {
    fullText: string;
    segments: Array<{ speaker: string; text: string; startTime: number; endTime: number }>;
    speakers: string[];
    duration: number;
  };
  meetingTitle: string;
}

export interface MeetingInsightsData {
  summary: string;
  actionItems: Array<{ description: string; assignee: string; deadline: string | null; priority: string }>;
  decisions: Array<{ description: string; madeBy: string; context: string }>;
  sentiment: 'positive' | 'neutral' | 'concerned';
  participantStats: Array<{ speaker: string; talkTimeSeconds: number; talkTimePercent: number }>;
  topics: string[];
}

/**
 * Calculate per-speaker talk time from transcript segments.
 */
export function calculateParticipantStats(
  segments: Array<{ speaker: string; startTime: number; endTime: number }>,
  totalDuration: number,
): Array<{ speaker: string; talkTimeSeconds: number; talkTimePercent: number }> {
  const speakerTime: Record<string, number> = {};

  for (const seg of segments) {
    const duration = Math.max(0, (seg.endTime || 0) - (seg.startTime || 0));
    speakerTime[seg.speaker] = (speakerTime[seg.speaker] || 0) + duration;
  }

  const total = Object.values(speakerTime).reduce((a, b) => a + b, 0) || totalDuration || 1;

  return Object.entries(speakerTime)
    .map(([speaker, seconds]) => ({
      speaker,
      talkTimeSeconds: Math.round(seconds),
      talkTimePercent: Math.round((seconds / total) * 100),
    }))
    .sort((a, b) => b.talkTimeSeconds - a.talkTimeSeconds);
}

/**
 * Extract action items from transcript using simple heuristics.
 * In production, this would call the AI model.
 */
export function extractActionItemsFromText(text: string): Array<{ description: string; assignee: string; deadline: string | null; priority: string }> {
  const items: Array<{ description: string; assignee: string; deadline: string | null; priority: string }> = [];
  const lines = text.split('\n');

  const actionPatterns = [
    /(?:^|\b)(?:I'll|I will|I'm going to|let me)\s+(.+)/i,
    /(?:^|\b)(\w+)\s+(?:will|should|needs? to|has to)\s+(.+)/i,
    /(?:^|\b)action item[:\s]+(.+)/i,
    /(?:^|\b)TODO[:\s]+(.+)/i,
    /(?:^|\b)follow[- ]up[:\s]+(.+)/i,
  ];

  for (const line of lines) {
    for (const pattern of actionPatterns) {
      const match = line.match(pattern);
      if (match) {
        items.push({
          description: match[match.length - 1].trim().slice(0, 200),
          assignee: match.length > 2 ? match[1].trim() : 'unassigned',
          deadline: null,
          priority: 'medium',
        });
        break;
      }
    }
  }

  return items.slice(0, 20);
}

/**
 * Extract decisions from transcript text.
 */
export function extractDecisionsFromText(text: string): Array<{ description: string; madeBy: string; context: string }> {
  const decisions: Array<{ description: string; madeBy: string; context: string }> = [];
  const lines = text.split('\n');

  const decisionPatterns = [
    /(?:^|\b)(?:we'?(?:ve|ll)|let'?s|decision[:\s])\s+(.+)/i,
    /(?:^|\b)(?:agreed|decided|settled on|going with)\s+(.+)/i,
  ];

  for (const line of lines) {
    for (const pattern of decisionPatterns) {
      const match = line.match(pattern);
      if (match) {
        // Try to extract speaker from line like "Speaker: ..."
        const speakerMatch = line.match(/^([A-Za-z][A-Za-z\s.'-]+?):\s/);
        decisions.push({
          description: match[1].trim().slice(0, 200),
          madeBy: speakerMatch ? speakerMatch[1].trim() : 'team',
          context: line.trim().slice(0, 300),
        });
        break;
      }
    }
  }

  return decisions.slice(0, 15);
}

/**
 * Simple sentiment analysis based on keyword frequency.
 */
export function analyzeSentiment(text: string): 'positive' | 'neutral' | 'concerned' {
  const lower = text.toLowerCase();
  const positive = ['great', 'excellent', 'good', 'love', 'amazing', 'happy', 'excited', 'perfect', 'awesome', 'agree'];
  const negative = ['problem', 'issue', 'concern', 'risk', 'worried', 'delay', 'blocker', 'difficult', 'fail', 'wrong'];

  let posCount = 0;
  let negCount = 0;
  for (const w of positive) posCount += (lower.match(new RegExp(`\\b${w}\\b`, 'g')) || []).length;
  for (const w of negative) negCount += (lower.match(new RegExp(`\\b${w}\\b`, 'g')) || []).length;

  if (posCount > negCount * 2) return 'positive';
  if (negCount > posCount * 2) return 'concerned';
  return 'neutral';
}

/**
 * Extract key topics from text using word frequency.
 */
export function extractTopics(text: string): string[] {
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'is', 'it', 'that', 'this', 'was', 'with', 'we', 'be', 'not', 'are', 'have', 'has', 'had', 'will', 'can', 'do', 'so', 'if', 'they', 'you', 'i', 'my', 'me', 'he', 'she', 'from', 'by', 'as', 'about', 'would', 'what', 'just', 'like', 'been', 'our', 'going', 'think', 'know', 'need', 'want', 'get', 'one']);
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
}

/**
 * Generate full meeting insights from transcript data.
 */
export function generateInsights(input: InsightInput): MeetingInsightsData {
  const { transcript } = input;

  const participantStats = calculateParticipantStats(
    transcript.segments as Array<{ speaker: string; startTime: number; endTime: number }>,
    transcript.duration,
  );

  const actionItems = extractActionItemsFromText(transcript.fullText);
  const decisions = extractDecisionsFromText(transcript.fullText);
  const sentiment = analyzeSentiment(transcript.fullText);
  const topics = extractTopics(transcript.fullText);

  // Generate summary from key stats
  const speakerList = transcript.speakers.join(', ') || 'participants';
  const durationMin = Math.round(transcript.duration / 60);
  const summaryParts = [
    `${durationMin}-minute meeting with ${speakerList}.`,
  ];
  if (topics.length > 0) summaryParts.push(`Key topics: ${topics.slice(0, 4).join(', ')}.`);
  if (decisions.length > 0) summaryParts.push(`${decisions.length} decision(s) made.`);
  if (actionItems.length > 0) summaryParts.push(`${actionItems.length} action item(s) identified.`);

  return {
    summary: summaryParts.join(' '),
    actionItems,
    decisions,
    sentiment,
    participantStats,
    topics,
  };
}

/**
 * Generate and store meeting insights in the database.
 */
export async function generateAndStoreInsights(prisma: any, input: InsightInput): Promise<void> {
  try {
    const insights = generateInsights(input);

    await prisma.meetingInsights.upsert({
      where: { meetingId: input.meetingId },
      create: {
        meetingId: input.meetingId,
        tenantId: input.tenantId,
        ...insights,
      },
      update: insights,
    });

    logger.info('Meeting insights generated', { meetingId: input.meetingId, tenantId: input.tenantId });
  } catch (err) {
    logger.error('Failed to generate meeting insights', {
      meetingId: input.meetingId,
      error: (err as Error).message,
    });
  }
}
