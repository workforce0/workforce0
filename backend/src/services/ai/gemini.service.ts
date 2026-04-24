/**
 * =============================================================================
 * GEMINI AI SERVICE
 * =============================================================================
 *
 * Integration with Google's Gemini AI for PRD generation.
 *
 * Model Selection:
 * ----------------
 * - gemini-2.0-flash: Used for PRD generation (long context, fast)
 * - gemini-2.0-flash: Fallback (same model for consistency)
 *
 * Why Gemini for PRDs?
 * --------------------
 * 1. Long context window (1M+ tokens) - handles full meeting transcripts
 * 2. Strong reasoning capabilities - extracts requirements accurately
 * 3. Structured output support - generates consistent JSON
 * 4. Cost-effective for high-volume processing
 *
 * Prompt Engineering Notes:
 * -------------------------
 * The PRD generation prompt is carefully crafted to:
 * - Provide clear role definition (Business Analyst)
 * - Specify exact output format (JSON schema)
 * - Include examples for each section
 * - Request confidence scoring
 * - Handle ambiguous inputs gracefully
 *
 * @module services/ai/gemini
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { createChildLogger } from '../../lib/logger.js';
import { AppError } from '../../lib/error-handler.js';
import { sanitizeForAI, wrapUserContent } from '../../lib/sanitize.js';
import { retryWithBackoff } from '../../lib/retry.js';
import { PRD_GENERATION_PROMPT, PRD_OUTPUT_SCHEMA } from './prompts.js';

/**
 * Response structure from PRD generation.
 *
 * This is a comprehensive PRD format with Executive Summary,
 * Problem Statement, and detailed sections - NOT just Jira tickets.
 */
export interface GeneratedPRD {
  /** Document metadata */
  metadata: {
    version: string;
    generatedAt: string;
    meetingDate?: string;
    participants?: string[];
  };

  /** Product/feature title */
  title: string;

  /** 1. EXECUTIVE SUMMARY */
  executiveSummary: {
    /** 2-3 paragraph overview of the product/feature */
    overview: string;
    /** Key value propositions (3-5 bullet points) */
    valueProposition: string[];
    /** Core capabilities being built */
    coreCapabilities: string[];
    /** What makes this unique */
    keyDifferentiators?: string[];
  };

  /** 2. PROBLEM STATEMENT */
  problemStatement: {
    /** Description of the current state/pain points */
    currentState: string;
    /** Specific problems being solved (bullet points) */
    problems: string[];
    /** Market gap or opportunity */
    marketOpportunity?: string;
  };

  /** 3. GOALS & OBJECTIVES */
  goals: {
    /** Product vision (one sentence) */
    vision: string;
    /** Measurable objectives with targets */
    objectives: Array<{
      objective: string;
      metric: string;
      target: string;
    }>;
    /** MVP success criteria (checkboxes) */
    successCriteria: string[];
  };

  /** 4. SCOPE */
  scope: {
    /** What's included in this PRD */
    inScope: string[];
    /** What's explicitly excluded */
    outOfScope: string[];
    /** Future considerations */
    futureConsiderations?: string[];
  };

  /** 5. USER STORIES */
  userStories: Array<{
    id: string;
    /** User persona (e.g., "Product Manager") */
    persona: string;
    /** Story in "As a... I want... So that..." format */
    story: string;
    /** Priority: must-have, should-have, nice-to-have */
    priority: 'must-have' | 'should-have' | 'nice-to-have';
    /** Acceptance criteria for this story */
    acceptanceCriteria: string[];
  }>;

  /** 6. FUNCTIONAL REQUIREMENTS */
  functionalRequirements: Array<{
    id: string;
    category: string;
    title: string;
    description: string;
    priority: 'must-have' | 'should-have' | 'nice-to-have';
  }>;

  /** 7. NON-FUNCTIONAL REQUIREMENTS */
  nonFunctionalRequirements: {
    performance?: string[];
    security?: string[];
    scalability?: string[];
    usability?: string[];
    reliability?: string[];
  };

  /** 8. SUCCESS METRICS */
  successMetrics: Array<{
    name: string;
    description: string;
    target: string;
    measurement: string;
  }>;

  /** 9. RISKS & MITIGATIONS */
  risks: Array<{
    description: string;
    impact: 'high' | 'medium' | 'low';
    probability: 'high' | 'medium' | 'low';
    mitigation: string;
  }>;

  /** 10. ASSUMPTIONS */
  assumptions: string[];

  /** 11. OPEN QUESTIONS - Things that need clarification */
  openQuestions: string[];

  /** 12. TIMELINE (if discussed) */
  timeline?: {
    estimatedDuration?: string;
    phases?: Array<{
      name: string;
      duration: string;
      deliverables: string[];
    }>;
  };

  /** AI confidence in this PRD (0.0 - 1.0) */
  confidence: number;

  /** AI's reasoning/analysis notes */
  reasoning?: string;
}

// Legacy interface for backwards compatibility during transition
export interface LegacyGeneratedPRD {
  title: string;
  summary: string;
  objectives: string[];
  requirements: Array<{
    id: string;
    title: string;
    description: string;
    priority: string;
    type: string;
    acceptanceCriteria: string[];
    estimatedEffort?: string;
  }>;
  acceptanceCriteria: string[];
  outOfScope: string[];
  assumptions: string[];
  risks: Array<{
    description: string;
    impact: string;
    mitigation?: string;
  }>;
  timeline?: string;
  confidence: number;
  reasoning?: string;
}

/**
 * Options for PRD generation.
 */
export interface GeneratePRDOptions {
  /** Additional context to include in prompt */
  additionalContext?: string;
  /** Max tokens for response */
  maxTokens?: number;
  /** Temperature (0-1, lower = more deterministic) */
  temperature?: number;
}

/**
 * Gemini AI Service for PRD generation.
 *
 * @example
 * ```typescript
 * const gemini = new GeminiService(apiKey);
 *
 * const prd = await gemini.generatePRD(transcript, {
 *   additionalContext: 'Focus on mobile-first requirements',
 *   temperature: 0.3, // More deterministic
 * });
 * ```
 */
export class GeminiService {
  private readonly client: GoogleGenerativeAI;
  private readonly model: GenerativeModel;
  private readonly logger = createChildLogger({ service: 'GeminiService' });

  /** Default model for PRD generation */
  private static readonly PRD_MODEL = 'gemini-2.0-flash';

  /** Fallback model if primary is unavailable */
  private static readonly FALLBACK_MODEL = 'gemini-2.0-flash';

  private readonly disabled: boolean;

  constructor(apiKey?: string) {
    if (!apiKey) {
      this.logger.warn('Gemini API key not configured - AI features disabled');
      this.disabled = true;
      this.client = null as any;
      this.model = null as any;
      return;
    }

    this.disabled = false;
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = this.client.getGenerativeModel({
      model: GeminiService.PRD_MODEL,
    });

    this.logger.info('Gemini service initialized', {
      model: GeminiService.PRD_MODEL,
    });
  }

  /**
   * Generate a PRD from a meeting transcript.
   *
   * This is the main method for PRD generation. It:
   * 1. Builds the prompt with transcript
   * 2. Calls Gemini API
   * 3. Parses and validates the response
   * 4. Handles errors and retries
   *
   * @param transcript - Full meeting transcript text
   * @param options - Generation options
   * @returns Generated PRD structure
   */
  async generatePRD(
    transcript: string,
    options: GeneratePRDOptions = {}
  ): Promise<GeneratedPRD> {
    const startTime = Date.now();
    this.logger.info('Starting PRD generation', {
      transcriptLength: transcript.length,
      hasAdditionalContext: !!options.additionalContext,
    });

    try {
      // Build the full prompt
      const prompt = this.buildPRDPrompt(transcript, options);

      // Call Gemini API with retry for transient failures
      const result = await retryWithBackoff(
        () => this.model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: options.maxTokens || 8192,
            temperature: options.temperature || 0.4,
            topP: 0.8,
            topK: 40,
          },
        }),
        { maxRetries: 3, initialDelayMs: 2000, label: 'Gemini API' },
      );

      // Extract response text
      const response = result.response;
      const text = response.text();

      this.logger.debug('Received Gemini response', {
        responseLength: text.length,
        finishReason: response.candidates?.[0]?.finishReason,
      });

      // Parse JSON from response
      const prd = this.parseResponse(text);

      const duration = Date.now() - startTime;
      this.logger.info('PRD generation completed', {
        duration,
        confidence: prd.confidence,
        userStoriesCount: prd.userStories.length,
        functionalReqsCount: prd.functionalRequirements.length,
      });

      return prd;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('PRD generation failed', {
        duration,
        error: (error as Error).message,
      });

      // Wrap in AppError for consistent handling
      if (error instanceof AppError) throw error;

      throw new AppError(
        `AI generation failed: ${(error as Error).message}`,
        502,
        'AI_GENERATION_ERROR'
      );
    }
  }

  /**
   * Build the full prompt for PRD generation.
   */
  private buildPRDPrompt(transcript: string, options: GeneratePRDOptions): string {
    let prompt = PRD_GENERATION_PROMPT;

    // Add output schema
    prompt += `\n\n## Expected Output Format\n${PRD_OUTPUT_SCHEMA}`;

    // Add additional context if provided
    if (options.additionalContext) {
      prompt += `\n\n## Additional Context\n${options.additionalContext}`;
    }

    // Add the transcript with sanitization and clear boundary markers
    const sanitizedTranscript = sanitizeForAI(transcript);
    prompt += `\n\n## Meeting Transcript${wrapUserContent('TRANSCRIPT', sanitizedTranscript)}`;

    // Final instruction
    prompt += '\n\nAnalyze the transcript above (within the USER_CONTENT boundaries) and generate a PRD in JSON format. Include your reasoning.';

    return prompt;
  }

  /**
   * Parse the AI response into structured PRD.
   * Handles various response formats:
   * - Pure JSON
   * - JSON in markdown code block
   * - Prose followed by JSON or code block
   */
  private parseResponse(text: string): GeneratedPRD {
    // Try multiple extraction strategies
    const jsonText = this.extractJSON(text);

    try {
      const parsed = JSON.parse(jsonText);

      // Validate required fields for new format
      if (!parsed.title) {
        throw new Error('Missing required field: title');
      }
      if (!parsed.executiveSummary?.overview) {
        throw new Error('Missing required field: executiveSummary.overview');
      }

      // Build comprehensive PRD with sensible defaults
      const prd: GeneratedPRD = {
        metadata: {
          version: parsed.metadata?.version || '1.0',
          generatedAt: parsed.metadata?.generatedAt || new Date().toISOString(),
          meetingDate: parsed.metadata?.meetingDate,
          participants: parsed.metadata?.participants || [],
        },
        title: parsed.title,
        executiveSummary: {
          overview: parsed.executiveSummary.overview,
          valueProposition: parsed.executiveSummary.valueProposition || [],
          coreCapabilities: parsed.executiveSummary.coreCapabilities || [],
          keyDifferentiators: parsed.executiveSummary.keyDifferentiators,
        },
        problemStatement: {
          currentState: parsed.problemStatement?.currentState || 'Not specified in transcript',
          problems: parsed.problemStatement?.problems || [],
          marketOpportunity: parsed.problemStatement?.marketOpportunity,
        },
        goals: {
          vision: parsed.goals?.vision || parsed.executiveSummary?.overview?.substring(0, 200) || '',
          objectives: parsed.goals?.objectives || [],
          successCriteria: parsed.goals?.successCriteria || [],
        },
        scope: {
          inScope: parsed.scope?.inScope || [],
          outOfScope: parsed.scope?.outOfScope || [],
          futureConsiderations: parsed.scope?.futureConsiderations,
        },
        userStories: (parsed.userStories || []).map((s: Record<string, unknown>, i: number) => ({
          id: s.id || `US-${String(i + 1).padStart(3, '0')}`,
          persona: s.persona || 'User',
          story: s.story || '',
          priority: s.priority || 'should-have',
          acceptanceCriteria: s.acceptanceCriteria || [],
        })),
        functionalRequirements: (parsed.functionalRequirements || []).map((r: Record<string, unknown>, i: number) => ({
          id: r.id || `FR-${String(i + 1).padStart(3, '0')}`,
          category: r.category || 'General',
          title: r.title || '',
          description: r.description || '',
          priority: r.priority || 'should-have',
        })),
        nonFunctionalRequirements: {
          performance: parsed.nonFunctionalRequirements?.performance || [],
          security: parsed.nonFunctionalRequirements?.security || [],
          scalability: parsed.nonFunctionalRequirements?.scalability || [],
          usability: parsed.nonFunctionalRequirements?.usability || [],
          reliability: parsed.nonFunctionalRequirements?.reliability || [],
        },
        successMetrics: parsed.successMetrics || [],
        risks: (parsed.risks || []).map((r: Record<string, unknown>) => ({
          description: r.description || '',
          impact: r.impact || 'medium',
          probability: r.probability || 'medium',
          mitigation: r.mitigation || 'To be determined',
        })),
        assumptions: parsed.assumptions || [],
        openQuestions: parsed.openQuestions || [],
        timeline: parsed.timeline,
        confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
        reasoning: parsed.reasoning,
      };

      return prd;

    } catch (parseError) {
      this.logger.error('Failed to parse AI response', {
        error: (parseError as Error).message,
        responsePreview: text.substring(0, 500),
      });

      throw new AppError(
        'Failed to parse AI response as JSON',
        502,
        'AI_PARSE_ERROR'
      );
    }
  }

  /**
   * Extract JSON from AI response, handling various formats.
   */
  private extractJSON(text: string): string {
    // Strategy 1: Look for JSON in markdown code block
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }

    // Strategy 2: Find JSON object starting with { and ending with }
    // This handles prose followed by JSON
    const jsonStartIndex = text.indexOf('{');
    const jsonEndIndex = text.lastIndexOf('}');
    if (jsonStartIndex !== -1 && jsonEndIndex > jsonStartIndex) {
      const potentialJson = text.substring(jsonStartIndex, jsonEndIndex + 1);
      // Validate it's parseable before returning
      try {
        JSON.parse(potentialJson);
        return potentialJson;
      } catch {
        // Not valid JSON, continue to next strategy
      }
    }

    // Strategy 3: Return trimmed text as-is (pure JSON)
    return text.trim();
  }

  /**
   * Test the connection to Gemini API.
   */
  async testConnection(): Promise<boolean> {
    try {
      const result = await this.model.generateContent('Say "OK" if you can hear me.');
      return result.response.text().includes('OK');
    } catch {
      return false;
    }
  }

  /**
   * Generate freeform text from a single prompt string. Used by services
   * that need a Gemini call without the PRD-specific scaffolding in
   * generatePRD (e.g. ArchitectService, TitleGenerator, memory summarization).
   */
  async generateFreeformText(prompt: string): Promise<string> {
    const result = await this.model.generateContent(prompt);
    return result.response.text();
  }
}
