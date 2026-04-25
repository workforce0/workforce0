/**
 * OllamaService — local LLM provider via Ollama's OpenAI-compatible API.
 *
 * When OLLAMA_BASE_URL is unset the service stays disabled (isEnabled=false)
 * and the AI Council skips it. When set, calls go to /v1/chat/completions.
 *
 * @module services/ai/ollama
 */

import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'OllamaService' });

export interface OllamaServiceConfig {
  baseUrl: string | undefined;
  keepAlive?: string;
}

export interface OllamaGenerateInput {
  model: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface OllamaGenerateResult {
  text: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export class OllamaService {
  constructor(private readonly config: OllamaServiceConfig) {}

  isEnabled(): boolean {
    return typeof this.config.baseUrl === 'string' && this.config.baseUrl.length > 0;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.config.baseUrl) return false;
    try {
      const res = await fetch(`${this.config.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2_000) });
      return res.ok;
    } catch (err) {
      logger.debug({ err: (err as Error).message }, 'Ollama availability check failed');
      return false;
    }
  }

  async generate(input: OllamaGenerateInput): Promise<OllamaGenerateResult> {
    if (!this.config.baseUrl) throw new Error('OllamaService not configured');

    const messages = [
      ...(input.systemPrompt ? [{ role: 'system' as const, content: input.systemPrompt }] : []),
      { role: 'user' as const, content: input.prompt },
    ];

    const res = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: input.model,
        messages,
        temperature: input.temperature ?? 0.7,
        max_tokens: input.maxTokens,
        keep_alive: this.config.keepAlive ?? '30m',
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama generate failed: ${res.status} ${body}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    return {
      text: data.choices[0]?.message?.content ?? '',
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
    };
  }

  /** Pre-warm a model so first real request doesn't pay cold-load latency. */
  async warmModel(model: string): Promise<void> {
    try {
      await this.generate({ model, prompt: ' ', maxTokens: 1 });
    } catch (err) {
      logger.warn({ model, err: (err as Error).message }, 'Ollama warmModel failed (non-fatal)');
    }
  }
}
