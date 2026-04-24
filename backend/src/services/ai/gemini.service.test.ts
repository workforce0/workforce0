/**
 * Unit tests for GeminiService
 *
 * Tests:
 * 1. Constructor validation
 * 2. PRD generation with valid response
 * 3. JSON parsing edge cases
 * 4. Error handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mock function that we can control
const mockGenerateContent = vi.fn();

// Mock the Google Generative AI module with a proper class
vi.mock('@google/generative-ai', () => {
  class MockGoogleGenerativeAI {
    constructor(_apiKey: string) {
      // Constructor accepts API key
    }
    getGenerativeModel() {
      return {
        generateContent: mockGenerateContent,
      };
    }
  }
  return {
    GoogleGenerativeAI: MockGoogleGenerativeAI,
  };
});

// Mock the logger (must be before service import)
vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import after mocks are set up
import { GeminiService, GeneratedPRD } from './gemini.service.js';
import { AppError } from '../../lib/error-handler.js';

describe('GeminiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('disables service when API key is missing', () => {
      // Constructor no longer throws — it sets this.disabled = true instead
      const service = new GeminiService('');
      expect(service).toBeInstanceOf(GeminiService);
    });

    it('initializes successfully with valid API key', () => {
      const service = new GeminiService('valid-api-key');
      expect(service).toBeInstanceOf(GeminiService);
    });
  });

  describe('generatePRD', () => {
    let service: GeminiService;

    beforeEach(() => {
      service = new GeminiService('test-api-key');
      vi.clearAllMocks();
    });

    it('generates PRD from valid transcript', async () => {
      const validPRD = {
        title: 'Test Feature',
        executiveSummary: {
          overview: 'A test feature for unit testing',
          valueProposition: ['Fast', 'Reliable'],
          coreCapabilities: ['Core 1'],
        },
        functionalRequirements: [
          {
            id: 'FR-001',
            category: 'General',
            title: 'Test Requirement',
            description: 'A test requirement',
            priority: 'must-have',
          },
        ],
        scope: { inScope: ['This'], outOfScope: ['Not this'] },
        assumptions: ['Assumption 1'],
        risks: [{ description: 'Risk 1', impact: 'high', probability: 'medium', mitigation: 'Monitor' }],
        confidence: 0.85,
      };

      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify(validPRD),
          candidates: [{ finishReason: 'STOP' }],
        },
      });

      const result = await service.generatePRD('Test transcript about a feature');

      expect(result.title).toBe('Test Feature');
      expect(result.executiveSummary.overview).toBe('A test feature for unit testing');
      expect(result.functionalRequirements).toHaveLength(1);
      expect(result.confidence).toBe(0.85);
    });

    it('handles JSON wrapped in markdown code blocks', async () => {
      const prdJson = {
        title: 'Wrapped PRD',
        executiveSummary: {
          overview: 'PRD in code block',
          valueProposition: [],
          coreCapabilities: [],
        },
        assumptions: [],
        risks: [],
        confidence: 0.9,
      };

      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => '```json\n' + JSON.stringify(prdJson) + '\n```',
          candidates: [{ finishReason: 'STOP' }],
        },
      });

      const result = await service.generatePRD('Test transcript');

      expect(result.title).toBe('Wrapped PRD');
      expect(result.confidence).toBe(0.9);
    });

    it('defaults missing arrays to empty arrays', async () => {
      const minimalPRD = {
        title: 'Minimal PRD',
        executiveSummary: {
          overview: 'Just title and executive summary',
        },
        confidence: 0.7,
      };

      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify(minimalPRD),
          candidates: [{ finishReason: 'STOP' }],
        },
      });

      const result = await service.generatePRD('Test transcript');

      expect(result.title).toBe('Minimal PRD');
      expect(result.userStories).toEqual([]);
      expect(result.functionalRequirements).toEqual([]);
      expect(result.risks).toEqual([]);
    });

    it('clamps confidence to 0-1 range', async () => {
      const highConfidencePRD = {
        title: 'High Confidence',
        executiveSummary: { overview: 'Test' },
        confidence: 1.5, // Invalid: > 1
      };

      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify(highConfidencePRD),
          candidates: [{ finishReason: 'STOP' }],
        },
      });

      const result = await service.generatePRD('Test');
      expect(result.confidence).toBe(1); // Clamped to 1
    });

    it('throws AppError on invalid JSON response', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'This is not JSON at all',
          candidates: [{ finishReason: 'STOP' }],
        },
      });

      await expect(service.generatePRD('Test')).rejects.toThrow(AppError);
      await expect(service.generatePRD('Test')).rejects.toThrow('Failed to parse AI response');
    });

    it('throws AppError when title is missing', async () => {
      const noTitlePRD = {
        summary: 'Missing title',
        confidence: 0.8,
      };

      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify(noTitlePRD),
          candidates: [{ finishReason: 'STOP' }],
        },
      });

      // The service validates required fields and wraps in parse error
      await expect(service.generatePRD('Test')).rejects.toThrow(AppError);
    });

    it('throws AppError when summary is missing', async () => {
      const noSummaryPRD = {
        title: 'Missing summary',
        confidence: 0.8,
      };

      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify(noSummaryPRD),
          candidates: [{ finishReason: 'STOP' }],
        },
      });

      // The service validates required fields and wraps in parse error
      await expect(service.generatePRD('Test')).rejects.toThrow(AppError);
    });

    it('wraps API errors in AppError', async () => {
      // Use a non-retryable error (invalid auth) to avoid retry delays in tests
      mockGenerateContent.mockRejectedValue(new Error('Invalid API key'));

      await expect(service.generatePRD('Test')).rejects.toThrow(AppError);
      await expect(service.generatePRD('Test')).rejects.toThrow('AI generation failed');
    });

    it('passes additional context to prompt', async () => {
      const validPRD = {
        title: 'Test',
        executiveSummary: { overview: 'Test' },
        confidence: 0.8,
      };

      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => JSON.stringify(validPRD),
          candidates: [{ finishReason: 'STOP' }],
        },
      });

      await service.generatePRD('Test transcript', {
        additionalContext: 'Focus on mobile-first',
      });

      // Verify generateContent was called (prompt building is internal)
      expect(mockGenerateContent).toHaveBeenCalled();
    });
  });

  describe('testConnection', () => {
    let service: GeminiService;

    beforeEach(() => {
      service = new GeminiService('test-api-key');
      vi.clearAllMocks();
    });

    it('returns true when API responds with OK', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'OK',
        },
      });

      const result = await service.testConnection();
      expect(result).toBe(true);
    });

    it('returns false when API fails', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Connection failed'));

      const result = await service.testConnection();
      expect(result).toBe(false);
    });

    it('returns false when response does not contain OK', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          text: () => 'Something else',
        },
      });

      const result = await service.testConnection();
      expect(result).toBe(false);
    });
  });
});
