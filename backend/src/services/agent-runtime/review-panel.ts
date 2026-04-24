/**
 * =============================================================================
 * REVIEW PANEL — Confidence-Based Multi-Model Validation
 * =============================================================================
 *
 * The ReviewPanel gates agent output quality by routing it through one or more
 * reviewer models depending on the agent's self-reported confidence:
 *
 *   >= 0.9   → auto-pass (skip review entirely)
 *   0.7–0.89 → single reviewer (first in the list)
 *   < 0.7    → full panel (all reviewers)
 *
 * Each reviewer scores the output and provides feedback. The final confidence
 * is the average of all reviewer scores. The output is approved when the
 * final confidence meets or exceeds the caller-supplied threshold.
 *
 * @module services/agent-runtime/review-panel
 */

import type { ModelClient } from './types.js';

export interface ReviewParams {
  agentOutput: string;
  confidence: number;
  reviewers: Array<{ provider: string; modelId: string }>;
  confidenceThreshold: number;
  context: string;
}

export interface ReviewResult {
  approved: boolean;
  finalConfidence: number;
  reviews: Array<{
    provider: string;
    modelId: string;
    confidence: number;
    feedback: string;
  }>;
  skippedReview: boolean;
  engagementPaused: boolean;
  pauseReason?: string;
  requiresHumanApproval: boolean;
}

/**
 * System prompt sent to each reviewer model.
 */
const REVIEWER_SYSTEM_PROMPT = `You are a quality reviewer for an AI consulting firm platform.

You will receive an agent's output along with the original context. Your job is to:
1. Evaluate the quality, completeness, and accuracy of the output.
2. Provide constructive feedback.
3. Score your confidence in the output's quality from 0.0 to 1.0.

Always end your response with exactly this format:
Confidence: X.XX
Feedback: <your feedback here>`;

export class ReviewPanel {
  constructor(private modelClients: Map<string, ModelClient>) {}

  /**
   * Review agent output based on confidence thresholds.
   *
   * - confidence >= 0.9: auto-pass, no reviewers consulted
   * - confidence 0.7-0.89: single reviewer (first in list)
   * - confidence < 0.7: full panel review (all reviewers)
   */
  async review(params: ReviewParams): Promise<ReviewResult> {
    const {
      agentOutput,
      confidence,
      reviewers,
      confidenceThreshold,
      context,
    } = params;

    // Auto-pass for high-confidence outputs
    if (confidence >= 0.9) {
      return {
        approved: true,
        finalConfidence: confidence,
        reviews: [],
        skippedReview: true,
        engagementPaused: false,
        requiresHumanApproval: false,
      };
    }

    // Determine which reviewers to use
    const activeReviewers =
      confidence >= 0.7 ? reviewers.slice(0, 1) : [...reviewers];

    // Collect reviews from each active reviewer
    const reviews: ReviewResult['reviews'] = [];

    for (const reviewer of activeReviewers) {
      const client = this.modelClients.get(reviewer.provider);
      if (!client) {
        continue;
      }

      const reviewMessage = [
        '## Agent Output to Review',
        agentOutput,
        '',
        '## Original Context',
        context,
        '',
        'Please evaluate this output for quality, completeness, and accuracy.',
        'Provide your confidence score and feedback.',
      ].join('\n');

      try {
        const response = await client.chat({
          model: reviewer.modelId,
          systemPrompt: REVIEWER_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: reviewMessage }],
          tools: [],
        });

        const reviewConfidence = this.extractConfidence(response.content);
        const feedback = this.extractFeedback(response.content);

        reviews.push({
          provider: reviewer.provider,
          modelId: reviewer.modelId,
          confidence: reviewConfidence,
          feedback,
        });
      } catch {
        // If a reviewer fails, add a zero-confidence review so it counts
        reviews.push({
          provider: reviewer.provider,
          modelId: reviewer.modelId,
          confidence: 0,
          feedback: 'Reviewer failed to respond',
        });
      }
    }

    // Calculate final confidence as the average of all reviewer scores
    const finalConfidence =
      reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.confidence, 0) / reviews.length
        : confidence;

    // Check if ALL reviewers returned confidence below 50%
    const allBelowFifty =
      reviews.length > 0 && reviews.every((r) => r.confidence < 0.5);

    // Engagement pause: all reviewers below 50% confidence
    if (allBelowFifty) {
      return {
        approved: false,
        finalConfidence,
        reviews,
        skippedReview: false,
        engagementPaused: true,
        pauseReason: 'All reviewers below 50% confidence threshold',
        requiresHumanApproval: false,
      };
    }

    // Determine if human approval is required (below 70% but not paused)
    const requiresHumanApproval =
      finalConfidence < 0.7 && !allBelowFifty;

    return {
      approved: finalConfidence >= confidenceThreshold,
      finalConfidence,
      reviews,
      skippedReview: false,
      engagementPaused: false,
      requiresHumanApproval,
    };
  }

  /**
   * Extract confidence score from reviewer response.
   * Looks for "Confidence: X.XX" pattern. Defaults to 0.5.
   */
  private extractConfidence(content: string): number {
    const match = content.match(/Confidence:\s*([\d.]+)/i);
    if (match) {
      const value = parseFloat(match[1]);
      if (!isNaN(value) && value >= 0 && value <= 1) {
        return value;
      }
    }
    return 0.5;
  }

  /**
   * Extract feedback from reviewer response.
   * Looks for "Feedback: ..." pattern. Falls back to full content.
   */
  private extractFeedback(content: string): string {
    const match = content.match(/Feedback:\s*(.+)/is);
    if (match) {
      return match[1].trim();
    }
    return content;
  }
}
