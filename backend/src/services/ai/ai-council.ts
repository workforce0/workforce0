/**
 * =============================================================================
 * AI COUNCIL - MULTI-MODEL CONSENSUS SERVICE
 * =============================================================================
 *
 * Orchestrates multiple AI models for adversarial review and consensus.
 *
 * The AI Council Pattern:
 * -----------------------
 * 1. PRIMARY MODEL generates initial output (e.g., Gemini generates PRD)
 * 2. CRITIQUE MODEL reviews adversarially (e.g., GPT-4o finds problems)
 * 3. CONSENSUS is reached through structured debate
 * 4. HUMAN REVIEW is triggered for low-confidence or disputed items
 *
 * Why Multi-Model?
 * ----------------
 * - Different models have different blind spots
 * - Adversarial review catches errors single models miss
 * - Consensus increases reliability
 * - Reduces hallucination risk
 *
 * Model Roles by Agent (from PRD):
 * --------------------------------
 * | Agent      | Primary          | Critique/Consensus           |
 * |------------|------------------|------------------------------|
 * | BA Agent   | Gemini Flash     | GPT-4o (adversarial)         |
 * | Dev Agent  | Claude Sonnet    | Gemini + GPT-4o (triple)     |
 * | Sales      | Gemini Flash     | GPT-4o                       |
 * | Marketing  | Gemini Flash     | GPT-4o                       |
 *
 * @module services/ai/council
 */

import { createChildLogger } from '../../lib/logger.js';
import {
  emitCouncilSessionComplete,
  type CouncilExitReason,
} from '../../lib/telemetry/council-telemetry.js';
import { GeminiService, GeneratedPRD, GeneratePRDOptions } from './gemini.service.js';
import { OpenAIService, CritiqueResult, ConsensusVote } from './openai.service.js';

/**
 * Council decision result.
 */
export interface CouncilDecision {
  /** Final outcome */
  decision: 'approved' | 'needs_revision' | 'rejected' | 'needs_human_review';

  /** Combined confidence from all models */
  confidence: number;

  /** The PRD (potentially revised after critique feedback) */
  prd: GeneratedPRD;

  /** Critique from adversarial model */
  critique?: CritiqueResult;

  /** All model votes (includes revision votes if PRD was regenerated) */
  votes: ConsensusVote[];

  /** Whether consensus was reached (critique approved) */
  consensusReached?: boolean;

  /** Issues that need addressing */
  outstandingIssues: string[];

  /** Questions for human clarification */
  clarificationQuestions: string[];

  /** Cost of this council session */
  estimatedCost: {
    gemini: number;
    openai: number;
    total: number;
  };

  /** Timing breakdown */
  timing: {
    primaryGeneration: number;
    critique: number;
    consensus: number;
    revision?: number;
    total: number;
  };
}

/**
 * Council configuration.
 */
export interface CouncilConfig {
  /** Minimum confidence for auto-approval */
  autoApproveThreshold: number;

  /** Below this, always require human review */
  humanReviewThreshold: number;

  /** Enable critique phase */
  enableCritique: boolean;

  /** Enable consensus voting */
  enableConsensus: boolean;

  /** Max critique iterations before escalating */
  maxCritiqueIterations: number;
}

const DEFAULT_CONFIG: CouncilConfig = {
  autoApproveThreshold: 0.9,
  humanReviewThreshold: 0.7,
  enableCritique: true,
  enableConsensus: true,
  maxCritiqueIterations: 2,
};

/**
 * AI Council for multi-model consensus.
 *
 * @example
 * ```typescript
 * const council = new AICouncil(gemini, openai);
 *
 * // Generate and validate PRD with full council
 * const decision = await council.generatePRDWithCouncil(transcript);
 *
 * if (decision.decision === 'approved') {
 *   // PRD passed multi-model validation
 * } else if (decision.decision === 'needs_human_review') {
 *   // Ask human for clarification
 *   notifyHuman(decision.clarificationQuestions);
 * }
 * ```
 */
export class AICouncil {
  private readonly logger = createChildLogger({ service: 'AICouncil' });
  private readonly config: CouncilConfig;

  constructor(
    private readonly gemini: GeminiService,
    private readonly openai: OpenAIService,
    config: Partial<CouncilConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.logger.info('AI Council initialized', {
      enableCritique: this.config.enableCritique,
      enableConsensus: this.config.enableConsensus,
      openaiEnabled: openai.isEnabled(),
    });
  }

  /**
   * Generate a PRD with full council review and revision loop.
   *
   * Flow:
   * 1. Gemini generates initial PRD
   * 2. OpenAI critiques adversarially
   * 3. If critique says "revise", regenerate PRD with critique feedback
   * 4. Repeat critique/revision up to maxCritiqueIterations
   * 5. Final consensus vote
   * 6. Decision made based on votes
   *
   * @param transcript - Meeting transcript
   * @param options - Generation options
   * @returns Council decision with PRD and metadata
   */
  async generatePRDWithCouncil(
    transcript: string,
    options: GeneratePRDOptions = {}
  ): Promise<CouncilDecision> {
    const startTime = Date.now();
    const timing = { primaryGeneration: 0, critique: 0, consensus: 0, revision: 0, total: 0 };
    const votes: ConsensusVote[] = [];
    let critique: CritiqueResult | undefined;
    let iterationCount = 0;
    let consensusReached = false;
    let exitReason: CouncilExitReason = 'first_pass';
    let totalCostUsd = 0;
    try {

    this.logger.info('Starting council PRD generation', {
      transcriptLength: transcript.length,
      enableCritique: this.config.enableCritique,
      maxIterations: this.config.maxCritiqueIterations,
    });

    // Step 1: Primary Generation (Gemini)
    const primaryStart = Date.now();
    let prd = await this.gemini.generatePRD(transcript, options);
    timing.primaryGeneration = Date.now() - primaryStart;

    // Add Gemini's implicit vote
    votes.push({
      model: 'gemini-2.0-flash',
      vote: prd.confidence >= 0.8 ? 'approve' : 'revise',
      confidence: prd.confidence,
      concerns: [],
      reasoning: prd.reasoning || 'Primary generation complete',
    });

    // Step 2: Critique/Revision Loop
    while (
      this.config.enableCritique &&
      this.openai.isEnabled() &&
      iterationCount < this.config.maxCritiqueIterations &&
      !consensusReached
    ) {
      iterationCount++;

      // Get critique from OpenAI
      const critiqueStart = Date.now();
      critique = await this.openai.critiquePRD(prd, transcript);
      timing.critique += Date.now() - critiqueStart;

      this.logger.info(`Critique iteration ${iterationCount} completed`, {
        assessment: critique.overallAssessment,
        issueCount: critique.issues.length,
        criticalIssues: critique.issues.filter(i => i.severity === 'critical').length,
      });

      // Check if we need to revise
      if (critique.overallAssessment === 'approve') {
        // Critique approved, add vote and exit loop
        votes.push({
          model: 'gpt-4o-critique',
          vote: 'approve',
          confidence: critique.critiqueConfidence,
          concerns: [],
          reasoning: critique.reasoning,
        });
        consensusReached = true;
        exitReason = 'threshold';
      } else if (critique.overallAssessment === 'needs_revision' && iterationCount < this.config.maxCritiqueIterations) {
        // Critique wants revision - regenerate PRD with feedback
        this.logger.info('Regenerating PRD with critique feedback', {
          iteration: iterationCount,
          issueCount: critique.issues.length,
        });

        const revisionStart = Date.now();

        // Build revision context from critique
        const revisionContext = this.buildRevisionContext(critique);

        // Regenerate PRD with critique feedback
        prd = await this.gemini.generatePRD(transcript, {
          ...options,
          additionalContext: `${options.additionalContext || ''}\n\n## REVISION REQUIRED\n${revisionContext}`,
        });

        timing.revision += Date.now() - revisionStart;

        // Add revision vote
        votes.push({
          model: `gemini-2.0-flash-revision-${iterationCount}`,
          vote: prd.confidence >= 0.8 ? 'approve' : 'revise',
          confidence: prd.confidence,
          concerns: [],
          reasoning: `Revision ${iterationCount}: Addressed critique feedback`,
        });
      } else {
        // Critique rejected or max iterations reached
        votes.push({
          model: 'gpt-4o-critique',
          vote: critique.overallAssessment === 'reject' ? 'reject' : 'revise',
          confidence: critique.critiqueConfidence,
          concerns: critique.issues.map(i => i.description),
          reasoning: critique.reasoning,
        });
        exitReason = critique.overallAssessment === 'reject' ? 'rejected' : 'max_rounds';
        break;
      }
    }
    // If the loop exited because iterationCount hit the cap mid-revise (no
    // explicit break), reflect that.
    if (!consensusReached && iterationCount >= this.config.maxCritiqueIterations && exitReason === 'first_pass') {
      exitReason = 'max_rounds';
    }

    // Step 3: Final Consensus Vote (if enabled and not already reached)
    if (this.config.enableConsensus && this.openai.isEnabled() && !consensusReached) {
      const consensusStart = Date.now();
      const consensusVote = await this.openai.voteOnPRD(prd, votes);
      timing.consensus = Date.now() - consensusStart;
      votes.push(consensusVote);
    }

    timing.total = Date.now() - startTime;

    // Step 4: Make Decision
    const decision = this.makeDecision(prd, votes, critique);

    this.logger.info('Council decision made', {
      decision: decision.decision,
      confidence: decision.confidence,
      voteCount: votes.length,
      iterations: iterationCount,
      consensusReached,
      timing,
    });

    const cost = this.estimateCost(transcript.length, timing);
    totalCostUsd = cost.total;

    return {
      ...decision,
      prd,
      critique,
      votes,
      consensusReached,
      estimatedCost: cost,
      timing: { ...timing, revision: timing.revision },
    };
    } catch (err) {
      exitReason = 'error';
      throw err;
    } finally {
      timing.total = Date.now() - startTime;
      emitCouncilSessionComplete({
        agentType: 'ba_agent',
        rounds: iterationCount,
        exitReason,
        totalLatencyMs: timing.total,
        totalCostUsd,
        primaryProvider: 'google',
        primaryModelId: 'gemini-2.0-flash',
        reviewerCount: this.openai.isEnabled() && this.config.enableCritique ? 1 : 0,
      });
    }
  }

  /**
   * Build revision context from critique feedback.
   * This is passed to Gemini for PRD regeneration.
   */
  private buildRevisionContext(critique: CritiqueResult): string {
    const sections: string[] = [];

    sections.push('The previous PRD draft received the following critique. Please address these issues in your revised PRD:\n');

    // Add critical issues first
    const criticalIssues = critique.issues.filter(i => i.severity === 'critical');
    if (criticalIssues.length > 0) {
      sections.push('### CRITICAL ISSUES (Must Fix)');
      for (const issue of criticalIssues) {
        sections.push(`- ${issue.category}: ${issue.description}`);
        if (issue.suggestion) {
          sections.push(`  Suggestion: ${issue.suggestion}`);
        }
      }
      sections.push('');
    }

    // Add major issues
    const majorIssues = critique.issues.filter(i => i.severity === 'major');
    if (majorIssues.length > 0) {
      sections.push('### MAJOR ISSUES (Should Fix)');
      for (const issue of majorIssues) {
        sections.push(`- ${issue.category}: ${issue.description}`);
        if (issue.suggestion) {
          sections.push(`  Suggestion: ${issue.suggestion}`);
        }
      }
      sections.push('');
    }

    // Add missing risks that should be addressed
    if (critique.missingRisks && critique.missingRisks.length > 0) {
      sections.push('### MISSING RISKS (Should Address)');
      for (const risk of critique.missingRisks) {
        sections.push(`- ${risk}`);
      }
      sections.push('');
    }

    // Add clarification questions to address
    if (critique.clarificationQuestions && critique.clarificationQuestions.length > 0) {
      sections.push('### CLARIFICATIONS NEEDED');
      sections.push('If possible, infer answers from the transcript or flag as Open Questions:');
      for (const question of critique.clarificationQuestions) {
        sections.push(`- ${question}`);
      }
    }

    return sections.join('\n');
  }

  /**
   * Quick PRD generation without full council (for low-priority items).
   */
  async generatePRDQuick(
    transcript: string,
    options: GeneratePRDOptions = {}
  ): Promise<CouncilDecision> {
    const startTime = Date.now();

    let exitReason: CouncilExitReason = 'first_pass';
    let totalCostUsd = 0;
    try {
    const prd = await this.gemini.generatePRD(transcript, options);

    const timing = {
      primaryGeneration: Date.now() - startTime,
      critique: 0,
      consensus: 0,
      total: Date.now() - startTime,
    };

    return {
      decision: prd.confidence >= this.config.autoApproveThreshold
        ? 'approved'
        : prd.confidence >= this.config.humanReviewThreshold
          ? 'needs_revision'
          : 'needs_human_review',
      confidence: prd.confidence,
      prd,
      votes: [{
        model: 'gemini-2.0-flash',
        vote: 'approve',
        confidence: prd.confidence,
        concerns: [],
        reasoning: 'Quick generation - no council review',
      }],
      outstandingIssues: [],
      clarificationQuestions: [],
      estimatedCost: ((): CouncilDecision['estimatedCost'] => {
        const c = this.estimateCost(transcript.length, timing);
        totalCostUsd = c.total;
        return c;
      })(),
      timing,
    };
    } catch (err) {
      exitReason = 'error';
      throw err;
    } finally {
      emitCouncilSessionComplete({
        agentType: 'ba_agent',
        rounds: 0,
        exitReason,
        totalLatencyMs: Date.now() - startTime,
        totalCostUsd,
        primaryProvider: 'google',
        primaryModelId: 'gemini-2.0-flash',
        reviewerCount: 0,
      });
    }
  }

  /**
   * Make final decision based on votes.
   */
  private makeDecision(
    prd: GeneratedPRD,
    votes: ConsensusVote[],
    critique?: CritiqueResult
  ): Omit<CouncilDecision, 'prd' | 'critique' | 'votes' | 'estimatedCost' | 'timing'> {
    // Count votes
    const approveCount = votes.filter(v => v.vote === 'approve').length;
    const rejectCount = votes.filter(v => v.vote === 'reject').length;
    const reviseCount = votes.filter(v => v.vote === 'revise').length;

    // Calculate average confidence
    const avgConfidence = votes.reduce((sum, v) => sum + v.confidence, 0) / votes.length;

    // Collect issues and questions
    const outstandingIssues = critique?.issues
      .filter(i => i.severity !== 'minor')
      .map(i => i.description) || [];

    const clarificationQuestions = critique?.clarificationQuestions || [];

    // Decision logic
    let decision: CouncilDecision['decision'];

    if (rejectCount > 0) {
      // Any rejection = needs human review
      decision = 'needs_human_review';
    } else if (avgConfidence < this.config.humanReviewThreshold) {
      // Low confidence = human review
      decision = 'needs_human_review';
    } else if (reviseCount > 0 || outstandingIssues.length > 0) {
      // Some revisions needed
      decision = 'needs_revision';
    } else if (avgConfidence >= this.config.autoApproveThreshold) {
      // High confidence with no issues = auto-approve
      decision = 'approved';
    } else {
      // Medium confidence (between humanReview and autoApprove) = needs revision/review
      decision = 'needs_revision';
    }

    return {
      decision,
      confidence: avgConfidence,
      outstandingIssues,
      clarificationQuestions,
    };
  }

  /**
   * Estimate cost of the council session.
   *
   * Rough estimates based on typical token usage:
   * - Gemini Flash: ~$0.001/1K input, ~$0.002/1K output
   * - GPT-4o: ~$0.005/1K input, ~$0.015/1K output
   */
  private estimateCost(
    transcriptLength: number,
    timing: { primaryGeneration: number; critique: number; consensus: number }
  ): CouncilDecision['estimatedCost'] {
    const tokensPerChar = 0.25; // Rough estimate
    const inputTokens = transcriptLength * tokensPerChar;
    const geminiOutputTokens = 4000; // ~4K output for detailed PRD
    const openaiOutputTokens = 2000; // ~2K output for critique

    // Gemini cost (primary generation)
    // Input: $0.001/1K tokens, Output: $0.002/1K tokens
    const geminiCost = (inputTokens / 1000) * 0.001 + (geminiOutputTokens / 1000) * 0.002;

    // OpenAI cost (critique + consensus)
    // GPT-4o: Input $0.005/1K, Output $0.015/1K
    const openaiCost = timing.critique > 0
      ? (inputTokens / 1000) * 0.005 + (openaiOutputTokens / 1000) * 0.015
      : 0;

    return {
      gemini: Math.round(geminiCost * 10000) / 10000, // 4 decimal places
      openai: Math.round(openaiCost * 10000) / 10000,
      total: Math.round((geminiCost + openaiCost) * 10000) / 10000,
    };
  }

  /**
   * Get council status (for health checks).
   */
  getStatus(): {
    geminiEnabled: boolean;
    openaiEnabled: boolean;
    critiqueEnabled: boolean;
    consensusEnabled: boolean;
  } {
    return {
      geminiEnabled: true, // Gemini is required
      openaiEnabled: this.openai.isEnabled(),
      critiqueEnabled: this.config.enableCritique && this.openai.isEnabled(),
      consensusEnabled: this.config.enableConsensus && this.openai.isEnabled(),
    };
  }
}
