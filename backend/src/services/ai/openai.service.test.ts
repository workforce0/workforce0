/**
 * Unit tests for OpenAIService
 *
 * Tests:
 * 1. Constructor (enabled/disabled modes)
 * 2. PRD critique functionality
 * 3. Consensus voting
 * 4. Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIService, CritiqueResult, ConsensusVote } from './openai.service.js';
import type { GeneratedPRD } from './gemini.service.js';

// Mock the logger
vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Sample PRD for testing
const samplePRD = {
  title: 'Test Feature',
  summary: 'A test feature for unit testing',
  objectives: ['Test objective 1', 'Test objective 2'],
  requirements: [
    {
      id: 'REQ-001',
      title: 'Test Requirement',
      description: 'A test requirement',
      priority: 'must-have',
      type: 'functional',
      acceptanceCriteria: ['AC1', 'AC2'],
    },
  ],
  acceptanceCriteria: ['Overall AC1'],
  outOfScope: ['Not this'],
  assumptions: ['Assumption 1'],
  risks: [{ description: 'Risk 1', impact: 'high', probability: 'medium', mitigation: 'Monitor' }],
  confidence: 0.85,
} as any as GeneratedPRD;

describe('OpenAIService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('disables service when API key is missing', () => {
      const service = new OpenAIService();
      expect(service.isEnabled()).toBe(false);
    });

    it('disables service when API key is empty', () => {
      const service = new OpenAIService('');
      expect(service.isEnabled()).toBe(false);
    });

    it('enables service with valid API key', () => {
      const service = new OpenAIService('sk-test-key');
      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('critiquePRD', () => {
    describe('when disabled', () => {
      it('returns mock critique', async () => {
        const service = new OpenAIService();
        const result = await service.critiquePRD(samplePRD, 'test transcript');

        expect(result.overallAssessment).toBe('approve');
        expect(result.critiqueConfidence).toBe(0.5);
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0].description).toContain('disabled');
      });
    });

    describe('when enabled', () => {
      let service: OpenAIService;

      beforeEach(() => {
        service = new OpenAIService('sk-test-key');
      });

      it('returns parsed critique on valid response', async () => {
        const mockCritique: CritiqueResult = {
          overallAssessment: 'needs_revision',
          critiqueConfidence: 0.8,
          issues: [
            {
              severity: 'major',
              category: 'ambiguity',
              description: 'Requirements are vague',
              affectedSection: 'requirements',
              suggestion: 'Add specific metrics',
            },
          ],
          clarificationQuestions: ['What is the target user?'],
          strengths: ['Clear objectives'],
          missingRisks: ['Security considerations'],
          reasoning: 'The PRD needs more detail',
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: '```json\n' + JSON.stringify(mockCritique) + '\n```',
                },
              },
            ],
          }),
        });

        const result = await service.critiquePRD(samplePRD, 'test transcript');

        expect(result.overallAssessment).toBe('needs_revision');
        expect(result.critiqueConfidence).toBe(0.8);
        expect(result.issues).toHaveLength(1);
        expect(result.issues[0].severity).toBe('major');
      });

      it('returns cautious critique on API error', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => 'Internal Server Error',
        });

        const result = await service.critiquePRD(samplePRD, 'test transcript');

        expect(result.overallAssessment).toBe('needs_revision');
        expect(result.critiqueConfidence).toBe(0.3);
        expect(result.issues[0].description).toContain('manual review required');
      });

      it('handles network errors gracefully', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));

        const result = await service.critiquePRD(samplePRD, 'test transcript');

        expect(result.overallAssessment).toBe('needs_revision');
        expect(result.reasoning).toContain('unavailable');
      });

      it('handles malformed JSON response', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: 'Not valid JSON at all',
                },
              },
            ],
          }),
        });

        const result = await service.critiquePRD(samplePRD, 'test transcript');

        // Should return cautious critique on parse failure
        expect(result.overallAssessment).toBe('needs_revision');
      });
    });
  });

  describe('voteOnPRD', () => {
    describe('when disabled', () => {
      it('returns auto-approve with low confidence', async () => {
        const service = new OpenAIService();
        const result = await service.voteOnPRD(samplePRD);

        expect(result.model).toBe('openai-disabled');
        expect(result.vote).toBe('approve');
        expect(result.confidence).toBe(0.5);
        expect(result.concerns).toContain('OpenAI not configured - auto-approving');
      });
    });

    describe('when enabled', () => {
      let service: OpenAIService;

      beforeEach(() => {
        service = new OpenAIService('sk-test-key');
      });

      it('returns parsed vote on valid response', async () => {
        const mockVote = {
          vote: 'approve',
          confidence: 0.9,
          concerns: [],
          reasoning: 'PRD is well structured',
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: '```json\n' + JSON.stringify(mockVote) + '\n```',
                },
              },
            ],
          }),
        });

        const result = await service.voteOnPRD(samplePRD);

        expect(result.vote).toBe('approve');
        expect(result.confidence).toBe(0.9);
        expect(result.model).toBe('gpt-5.5');
      });

      it('considers existing votes when provided', async () => {
        const existingVotes: ConsensusVote[] = [
          {
            model: 'gemini-2.0-flash',
            vote: 'approve',
            confidence: 0.85,
            concerns: [],
            reasoning: 'Looks good',
          },
        ];

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    vote: 'approve',
                    confidence: 0.88,
                    concerns: [],
                    reasoning: 'Agree with other model',
                  }),
                },
              },
            ],
          }),
        });

        const result = await service.voteOnPRD(samplePRD, existingVotes);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            body: expect.stringContaining('gemini-2.0-flash'),
          })
        );
        expect(result.vote).toBe('approve');
      });

      it('returns revise vote on API failure', async () => {
        mockFetch.mockRejectedValueOnce(new Error('API error'));

        const result = await service.voteOnPRD(samplePRD);

        expect(result.vote).toBe('revise');
        expect(result.confidence).toBe(0.3);
        expect(result.concerns).toContain('Unable to complete vote - manual review recommended');
      });
    });
  });

  describe('testConnection', () => {
    it('returns false when disabled', async () => {
      const service = new OpenAIService();
      const result = await service.testConnection();
      expect(result).toBe(false);
    });

    it('returns true on successful API call', async () => {
      const service = new OpenAIService('sk-test-key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: 'OK',
              },
            },
          ],
        }),
      });

      const result = await service.testConnection();
      expect(result).toBe(true);
    });

    it('returns false on API failure', async () => {
      const service = new OpenAIService('sk-test-key');

      mockFetch.mockRejectedValueOnce(new Error('Connection failed'));

      const result = await service.testConnection();
      expect(result).toBe(false);
    });
  });
});
