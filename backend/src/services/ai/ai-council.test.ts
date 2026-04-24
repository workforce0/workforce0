/**
 * Unit tests for AICouncil
 *
 * Tests:
 * 1. Full council flow (Gemini + OpenAI)
 * 2. Quick generation (Gemini only)
 * 3. Decision logic
 * 4. Fallback when OpenAI disabled
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AICouncil, CouncilDecision } from './ai-council.js';
import { GeminiService, GeneratedPRD } from './gemini.service.js';
import { OpenAIService, CritiqueResult, ConsensusVote } from './openai.service.js';

// Mock the logger
vi.mock('../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Sample PRD for testing
const samplePRD = {
  title: 'Test Feature',
  summary: 'A test feature for unit testing',
  objectives: ['Test objective 1'],
  requirements: [
    {
      id: 'REQ-001',
      title: 'Test Requirement',
      description: 'A test requirement',
      priority: 'must-have',
      type: 'functional',
      acceptanceCriteria: ['AC1'],
    },
  ],
  acceptanceCriteria: ['Overall AC1'],
  outOfScope: ['Not this'],
  assumptions: ['Assumption 1'],
  risks: [{ description: 'Risk 1', impact: 'high', probability: 'medium', mitigation: 'Monitor' }],
  confidence: 0.85,
  reasoning: 'Test reasoning',
} as any as GeneratedPRD;

describe('AICouncil', () => {
  let mockGemini: GeminiService;
  let mockOpenAI: OpenAIService;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock Gemini service
    mockGemini = {
      generatePRD: vi.fn().mockResolvedValue(samplePRD),
    } as unknown as GeminiService;

    // Create mock OpenAI service (enabled)
    mockOpenAI = {
      isEnabled: vi.fn().mockReturnValue(true),
      critiquePRD: vi.fn().mockResolvedValue({
        overallAssessment: 'approve',
        critiqueConfidence: 0.8,
        issues: [],
        clarificationQuestions: [],
        strengths: ['Good structure'],
        missingRisks: [],
        reasoning: 'Looks good',
      } as CritiqueResult),
      voteOnPRD: vi.fn().mockResolvedValue({
        model: 'gpt-4o',
        vote: 'approve',
        confidence: 0.85,
        concerns: [],
        reasoning: 'Approved',
      } as ConsensusVote),
    } as unknown as OpenAIService;
  });

  describe('generatePRDWithCouncil', () => {
    it('completes full council flow with Gemini and OpenAI', async () => {
      const council = new AICouncil(mockGemini, mockOpenAI);

      const result = await council.generatePRDWithCouncil('test transcript');

      // Verify Gemini was called
      expect(mockGemini.generatePRD).toHaveBeenCalledWith('test transcript', {});

      // Verify OpenAI critique was called
      expect(mockOpenAI.critiquePRD).toHaveBeenCalled();

      // When critique approves, consensus is already reached so voteOnPRD is skipped
      expect(mockOpenAI.voteOnPRD).not.toHaveBeenCalled();

      // Verify result structure
      expect(result.prd).toEqual(samplePRD);
      expect(result.votes).toHaveLength(2); // Gemini + critique (consensus skipped when critique approves)
      expect(result.timing.primaryGeneration).toBeGreaterThanOrEqual(0);
    });

    it('skips critique when OpenAI is disabled', async () => {
      (mockOpenAI.isEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const council = new AICouncil(mockGemini, mockOpenAI);

      const result = await council.generatePRDWithCouncil('test transcript');

      // Verify critique was NOT called
      expect(mockOpenAI.critiquePRD).not.toHaveBeenCalled();

      // Only Gemini vote present
      expect(result.votes).toHaveLength(1);
      expect(result.critique).toBeUndefined();
    });

    it('passes additional options to Gemini', async () => {
      const council = new AICouncil(mockGemini, mockOpenAI);

      await council.generatePRDWithCouncil('test transcript', {
        additionalContext: 'Focus on mobile',
        temperature: 0.3,
      });

      expect(mockGemini.generatePRD).toHaveBeenCalledWith('test transcript', {
        additionalContext: 'Focus on mobile',
        temperature: 0.3,
      });
    });

    it('calculates estimated cost', async () => {
      const council = new AICouncil(mockGemini, mockOpenAI);

      const result = await council.generatePRDWithCouncil('test transcript');

      expect(result.estimatedCost).toBeDefined();
      expect(result.estimatedCost.gemini).toBeGreaterThanOrEqual(0);
      expect(result.estimatedCost.total).toEqual(
        result.estimatedCost.gemini + result.estimatedCost.openai
      );
    });
  });

  describe('generatePRDQuick', () => {
    it('only uses Gemini without critique', async () => {
      const council = new AICouncil(mockGemini, mockOpenAI);

      const result = await council.generatePRDQuick('test transcript');

      expect(mockGemini.generatePRD).toHaveBeenCalled();
      expect(mockOpenAI.critiquePRD).not.toHaveBeenCalled();
      expect(mockOpenAI.voteOnPRD).not.toHaveBeenCalled();

      expect(result.votes).toHaveLength(1);
      expect(result.timing.critique).toBe(0);
      expect(result.timing.consensus).toBe(0);
    });

    it('returns approved for high confidence PRD', async () => {
      (mockGemini.generatePRD as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...samplePRD,
        confidence: 0.95,
      });

      const council = new AICouncil(mockGemini, mockOpenAI);

      const result = await council.generatePRDQuick('test transcript');

      expect(result.decision).toBe('approved');
    });

    it('returns needs_revision for medium confidence', async () => {
      (mockGemini.generatePRD as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...samplePRD,
        confidence: 0.75,
      });

      const council = new AICouncil(mockGemini, mockOpenAI);

      const result = await council.generatePRDQuick('test transcript');

      expect(result.decision).toBe('needs_revision');
    });

    it('returns needs_human_review for low confidence', async () => {
      (mockGemini.generatePRD as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...samplePRD,
        confidence: 0.5,
      });

      const council = new AICouncil(mockGemini, mockOpenAI);

      const result = await council.generatePRDQuick('test transcript');

      expect(result.decision).toBe('needs_human_review');
    });
  });

  describe('decision logic', () => {
    it('rejects when any model votes reject', async () => {
      (mockOpenAI.critiquePRD as ReturnType<typeof vi.fn>).mockResolvedValue({
        overallAssessment: 'reject',
        critiqueConfidence: 0.9,
        issues: [{ severity: 'critical', description: 'Fatal flaw' }],
        clarificationQuestions: [],
        strengths: [],
        missingRisks: [],
        reasoning: 'Rejected',
      });

      const council = new AICouncil(mockGemini, mockOpenAI);

      const result = await council.generatePRDWithCouncil('test transcript');

      expect(result.decision).toBe('needs_human_review');
    });

    it('needs_revision when critique finds issues', async () => {
      (mockOpenAI.critiquePRD as ReturnType<typeof vi.fn>).mockResolvedValue({
        overallAssessment: 'needs_revision',
        critiqueConfidence: 0.8,
        issues: [
          { severity: 'major', description: 'Missing scope', affectedSection: 'scope' },
        ],
        clarificationQuestions: ['What about X?'],
        strengths: ['Good structure'],
        missingRisks: [],
        reasoning: 'Needs work',
      });

      (mockOpenAI.voteOnPRD as ReturnType<typeof vi.fn>).mockResolvedValue({
        model: 'gpt-4o',
        vote: 'revise',
        confidence: 0.7,
        concerns: ['Needs more detail'],
        reasoning: 'Revise',
      });

      const council = new AICouncil(mockGemini, mockOpenAI);

      const result = await council.generatePRDWithCouncil('test transcript');

      expect(result.decision).toBe('needs_revision');
      expect(result.outstandingIssues.length).toBeGreaterThan(0);
    });

    it('approves when all models approve with high confidence', async () => {
      (mockGemini.generatePRD as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...samplePRD,
        confidence: 0.95,
      });

      (mockOpenAI.critiquePRD as ReturnType<typeof vi.fn>).mockResolvedValue({
        overallAssessment: 'approve',
        critiqueConfidence: 0.92,
        issues: [],
        clarificationQuestions: [],
        strengths: ['Excellent'],
        missingRisks: [],
        reasoning: 'Approved',
      });

      (mockOpenAI.voteOnPRD as ReturnType<typeof vi.fn>).mockResolvedValue({
        model: 'gpt-4o',
        vote: 'approve',
        confidence: 0.93,
        concerns: [],
        reasoning: 'Approved',
      });

      const council = new AICouncil(mockGemini, mockOpenAI);

      const result = await council.generatePRDWithCouncil('test transcript');

      expect(result.decision).toBe('approved');
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe('getStatus', () => {
    it('returns correct status when OpenAI enabled', () => {
      const council = new AICouncil(mockGemini, mockOpenAI);

      const status = council.getStatus();

      expect(status.geminiEnabled).toBe(true);
      expect(status.openaiEnabled).toBe(true);
      expect(status.critiqueEnabled).toBe(true);
      expect(status.consensusEnabled).toBe(true);
    });

    it('returns correct status when OpenAI disabled', () => {
      (mockOpenAI.isEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const council = new AICouncil(mockGemini, mockOpenAI);

      const status = council.getStatus();

      expect(status.geminiEnabled).toBe(true);
      expect(status.openaiEnabled).toBe(false);
      expect(status.critiqueEnabled).toBe(false);
      expect(status.consensusEnabled).toBe(false);
    });
  });

  describe('configuration', () => {
    it('uses custom thresholds', async () => {
      const council = new AICouncil(mockGemini, mockOpenAI, {
        autoApproveThreshold: 0.95,
        humanReviewThreshold: 0.8,
      });

      // Confidence 0.85 would be approved with default (0.9), but needs revision with 0.95
      (mockGemini.generatePRD as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...samplePRD,
        confidence: 0.85,
      });

      const result = await council.generatePRDQuick('test transcript');

      // With humanReviewThreshold at 0.8, 0.85 is above it but below autoApprove
      expect(result.decision).toBe('needs_revision');
    });

    it('disables critique when configured', async () => {
      const council = new AICouncil(mockGemini, mockOpenAI, {
        enableCritique: false,
      });

      const result = await council.generatePRDWithCouncil('test transcript');

      expect(mockOpenAI.critiquePRD).not.toHaveBeenCalled();
    });

    it('disables consensus when configured', async () => {
      const council = new AICouncil(mockGemini, mockOpenAI, {
        enableConsensus: false,
      });

      const result = await council.generatePRDWithCouncil('test transcript');

      // Critique should still be called
      expect(mockOpenAI.critiquePRD).toHaveBeenCalled();
      // But consensus vote should not
      expect(mockOpenAI.voteOnPRD).not.toHaveBeenCalled();
    });
  });
});
