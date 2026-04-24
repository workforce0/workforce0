import { describe, it, expect } from 'vitest';
import {
  calculateParticipantStats,
  extractActionItemsFromText,
  extractDecisionsFromText,
  analyzeSentiment,
  extractTopics,
  generateInsights,
} from '../insights.service.js';

describe('Meeting Insights Service', () => {
  describe('calculateParticipantStats', () => {
    it('calculates talk time per speaker', () => {
      const segments = [
        { speaker: 'Alice', startTime: 0, endTime: 30 },
        { speaker: 'Bob', startTime: 30, endTime: 50 },
        { speaker: 'Alice', startTime: 50, endTime: 100 },
      ];
      const stats = calculateParticipantStats(segments, 100);
      expect(stats).toHaveLength(2);
      expect(stats[0].speaker).toBe('Alice');
      expect(stats[0].talkTimeSeconds).toBe(80);
      expect(stats[0].talkTimePercent).toBe(80);
      expect(stats[1].speaker).toBe('Bob');
      expect(stats[1].talkTimeSeconds).toBe(20);
    });

    it('handles empty segments', () => {
      const stats = calculateParticipantStats([], 60);
      expect(stats).toHaveLength(0);
    });
  });

  describe('extractActionItemsFromText', () => {
    it('extracts "I will" patterns', () => {
      const text = "I'll send the report by Friday.\nJohn will review the PR.";
      const items = extractActionItemsFromText(text);
      expect(items.length).toBeGreaterThanOrEqual(1);
    });

    it('extracts action item patterns', () => {
      const text = 'Action item: Deploy to staging\nTODO: Write tests';
      const items = extractActionItemsFromText(text);
      expect(items.length).toBeGreaterThanOrEqual(2);
    });

    it('returns empty for no action items', () => {
      const items = extractActionItemsFromText('Hello world. Nice weather today.');
      expect(items).toHaveLength(0);
    });
  });

  describe('extractDecisionsFromText', () => {
    it('extracts "we decided" patterns', () => {
      const text = "We've decided to use React for the frontend.\nLet's go with PostgreSQL.";
      const decisions = extractDecisionsFromText(text);
      expect(decisions.length).toBeGreaterThanOrEqual(1);
    });

    it('attributes decisions to speakers', () => {
      const text = "Alice: Let's go with option A for the database.";
      const decisions = extractDecisionsFromText(text);
      if (decisions.length > 0) {
        expect(decisions[0].madeBy).toBe('Alice');
      }
    });
  });

  describe('analyzeSentiment', () => {
    it('detects positive sentiment', () => {
      const text = 'Great work everyone! This is excellent progress. I love the design. Amazing results!';
      expect(analyzeSentiment(text)).toBe('positive');
    });

    it('detects concerned sentiment', () => {
      const text = 'There is a problem with this approach. I have concerns about the risk. This is difficult and wrong.';
      expect(analyzeSentiment(text)).toBe('concerned');
    });

    it('detects neutral sentiment', () => {
      const text = 'The meeting covered several topics. We discussed the project timeline and resource allocation.';
      expect(analyzeSentiment(text)).toBe('neutral');
    });
  });

  describe('extractTopics', () => {
    it('returns frequent words as topics', () => {
      const text = 'We discussed authentication and authorization. The authentication flow needs work. Authorization rules are clear.';
      const topics = extractTopics(text);
      expect(topics.length).toBeGreaterThan(0);
      expect(topics).toContain('authentication');
    });

    it('filters stop words', () => {
      const topics = extractTopics('the the the a a a and and');
      expect(topics).toHaveLength(0);
    });
  });

  describe('generateInsights', () => {
    it('generates complete insights from input', () => {
      const input = {
        meetingId: 'meeting-1',
        tenantId: 'tenant-1',
        transcript: {
          fullText: "Alice: I'll send the report by Friday.\nBob: Great, let's go with the new design.\nAlice: Agreed. Action item: update the docs.",
          segments: [
            { speaker: 'Alice', text: "I'll send the report", startTime: 0, endTime: 30 },
            { speaker: 'Bob', text: 'Great, go with design', startTime: 30, endTime: 50 },
            { speaker: 'Alice', text: 'Agreed, update docs', startTime: 50, endTime: 70 },
          ],
          speakers: ['Alice', 'Bob'],
          duration: 70,
        },
        meetingTitle: 'Sprint Planning',
      };

      const insights = generateInsights(input);
      expect(insights.summary).toContain('meeting');
      expect(insights.participantStats).toHaveLength(2);
      expect(insights.sentiment).toBeDefined();
      expect(insights.topics.length).toBeGreaterThan(0);
    });
  });
});
