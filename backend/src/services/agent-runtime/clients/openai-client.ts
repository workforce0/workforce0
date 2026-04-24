// mvp/src/services/agent-runtime/clients/openai-client.ts

import type { ModelClient } from '../types.js';

const DEFAULT_BASE_URL = 'https://api.openai.com';

interface OpenAIClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export class OpenAIClient implements ModelClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: OpenAIClientOptions) {
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
    // Build messages array with system prompt first
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: params.systemPrompt },
      ...params.messages,
    ];

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
    };

    if (params.tools.length > 0) {
      body.tools = params.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason: string;
      }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? '';

    // Parse tool calls
    const toolCalls = (choice?.message?.tool_calls ?? []).map((tc) => ({
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    // Map finish_reason
    let stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
    if (choice?.finish_reason === 'tool_calls') {
      stopReason = 'tool_use';
    } else if (choice?.finish_reason === 'length') {
      stopReason = 'max_tokens';
    } else {
      stopReason = 'end_turn';
    }

    return {
      content,
      toolCalls,
      tokenUsage: {
        input: data.usage?.prompt_tokens ?? 0,
        output: data.usage?.completion_tokens ?? 0,
      },
      stopReason,
    };
  }
}
