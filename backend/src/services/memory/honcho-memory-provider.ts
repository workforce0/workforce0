/**
 * =============================================================================
 * HONCHO MEMORY PROVIDER — external user modeling service
 * =============================================================================
 *
 * Hermes III M8. Honcho (honcho.dev) is the external user-modeling service
 * that Nous Research uses to give hermes-agent its "grows with you" story.
 * Our MemoryManager already reserves exactly one slot for an external
 * provider — this plugs Honcho into that slot.
 *
 * Contract:
 *   - Per-workspace user ID is the `userId` from MemoryProviderContext
 *   - Sessions in Workforce0 map 1:1 to Honcho sessions (same sessionId)
 *   - Honcho's `/dialectic` endpoint gives us ranked recall we inject as
 *     the fenced memory-context block (AGENTS.md rule)
 *   - syncTurn() posts the user/assistant pair to Honcho so it can
 *     update its internal user model
 *
 * Gracefully disables when HONCHO_API_KEY / HONCHO_APP_ID absent —
 * MemoryManager rejects a disabled external provider at add() time.
 *
 * @module services/memory/honcho-memory-provider
 */

import { createChildLogger } from '../../lib/logger.js';
import type {
  MemoryProvider,
  MemoryProviderContext,
  MemoryToolSchema,
} from './memory-provider.js';

export interface HonchoConfig {
  apiKey: string;
  baseUrl?: string; // default https://api.honcho.dev
  appId: string;
}

const DEFAULT_BASE_URL = 'https://demo.honcho.dev';

export class HonchoMemoryProvider implements MemoryProvider {
  readonly name = 'honcho';
  readonly isBuiltin = false;

  private readonly logger = createChildLogger({ service: 'HonchoMemoryProvider' });
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly appId: string;
  private currentContext: MemoryProviderContext | null = null;

  constructor(config: HonchoConfig) {
    this.apiKey = config.apiKey;
    this.appId = config.appId;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey && this.appId);
  }

  async initialize(ctx: MemoryProviderContext): Promise<void> {
    this.currentContext = ctx;
    if (!ctx.userId) {
      this.logger.warn('No userId in memory context — Honcho requires a user id; recall will be empty');
    }
  }

  systemPromptBlock(): string {
    return `You have access to a long-lived user model via the dialectic_ask tool (powered by Honcho). Use it sparingly — call before answering when knowing the user's history or preferences would change your answer. Do not narrate when you use it.`;
  }

  async prefetch(query: string, sessionId: string): Promise<string> {
    if (!this.currentContext?.userId) return '';
    try {
      const response = await this.call(
        `/apps/${this.appId}/users/${encodeURIComponent(this.currentContext.userId)}/sessions/${encodeURIComponent(sessionId)}/dialectic`,
        {
          method: 'POST',
          body: JSON.stringify({ queries: [query] }),
        },
      );
      // Honcho responds with { content: '...' } in the stable dialectic API
      const content = typeof response?.content === 'string' ? response.content.trim() : '';
      return content;
    } catch (err) {
      this.logger.debug('Honcho prefetch failed (non-fatal)', {
        error: (err as Error).message,
      });
      return '';
    }
  }

  async syncTurn(userContent: string, assistantContent: string, sessionId: string): Promise<void> {
    if (!this.currentContext?.userId) return;
    try {
      await this.call(
        `/apps/${this.appId}/users/${encodeURIComponent(this.currentContext.userId)}/sessions/${encodeURIComponent(sessionId)}/messages`,
        {
          method: 'POST',
          body: JSON.stringify([
            { role: 'user', content: userContent },
            { role: 'assistant', content: assistantContent },
          ]),
        },
      );
    } catch (err) {
      this.logger.warn('Honcho syncTurn failed', { error: (err as Error).message });
    }
  }

  getToolSchemas(): MemoryToolSchema[] {
    return [
      {
        name: 'dialectic_ask',
        description:
          'Query the long-lived user model (powered by Honcho) with a natural-language question about the current user. Use before answering when knowing the user\'s history or preferences would change your answer.',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'What do you want to know about the user?' },
          },
          required: ['question'],
        },
      },
    ];
  }

  async handleToolCall(name: string, args: Record<string, unknown>): Promise<string> {
    if (name !== 'dialectic_ask') return JSON.stringify({ error: `Unknown tool ${name}` });
    if (!this.currentContext?.userId) return JSON.stringify({ answer: 'No user context available' });
    const question = String(args.question ?? '').trim();
    if (!question) return JSON.stringify({ error: 'question is required' });
    const answer = await this.prefetch(question, this.currentContext.sessionId);
    return JSON.stringify({ answer: answer || 'No insight available yet' });
  }

  async shutdown(): Promise<void> {
    this.currentContext = null;
  }

  private async call(path: string, init: RequestInit): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '<no body>');
      throw new Error(`Honcho ${res.status} ${res.statusText}: ${body}`);
    }
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }
}
