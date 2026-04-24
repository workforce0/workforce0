// mvp/src/services/agent-runtime/clients/anthropic-client.ts

import type { ModelClient } from '../types.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';

interface AnthropicClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export class AnthropicClient implements ModelClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: AnthropicClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  async chat(params: {
    model: string;
    systemPrompt: string;
    messages: Array<{ role: string; content: string }>;
    tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  }): Promise<{
    content: string;
    toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
    tokenUsage: { input: number; output: number };
    stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
  }> {
    const body: Record<string, unknown> = {
      model: params.model,
      max_tokens: 4096,
      system: params.systemPrompt,
      messages: params.messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    };

    if (params.tools.length > 0) {
      body.tools = params.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }>;
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    // Extract text content
    const textParts = data.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '');
    const content = textParts.join('');

    // Extract tool_use blocks
    const toolCalls = data.content
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({
        name: block.name!,
        input: (block.input ?? {}) as Record<string, unknown>,
      }));

    // Map stop_reason
    let stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
    if (data.stop_reason === 'tool_use') {
      stopReason = 'tool_use';
    } else if (data.stop_reason === 'max_tokens') {
      stopReason = 'max_tokens';
    } else {
      stopReason = 'end_turn';
    }

    return {
      content,
      toolCalls,
      tokenUsage: {
        input: data.usage.input_tokens,
        output: data.usage.output_tokens,
      },
      stopReason,
    };
  }
}
