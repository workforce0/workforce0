// mvp/src/services/agent-runtime/clients/google-client.ts

import type { ModelClient } from '../types.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

interface GoogleClientOptions {
  apiKey: string;
}

export class GoogleClient implements ModelClient {
  private readonly apiKey: string;

  constructor(opts: GoogleClientOptions) {
    this.apiKey = opts.apiKey;
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
      contents: params.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    };

    // System prompt via systemInstruction
    if (params.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: params.systemPrompt }],
      };
    }

    // Map tools to functionDeclarations
    if (params.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: params.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          })),
        },
      ];
    }

    const url = `${BASE_URL}/models/${params.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as {
      candidates: Array<{
        content: { parts: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> };
        finishReason: string;
      }>;
      usageMetadata: { promptTokenCount: number; candidatesTokenCount: number };
    };

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];

    // Extract text content
    const textParts = parts.filter((p) => p.text != null).map((p) => p.text!);
    const content = textParts.join('');

    // Extract function calls
    const toolCalls = parts
      .filter((p) => p.functionCall != null)
      .map((p) => ({
        name: p.functionCall!.name,
        input: (p.functionCall!.args ?? {}) as Record<string, unknown>,
      }));

    // Map finish reason
    let stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
    const finishReason = candidate?.finishReason;
    if (toolCalls.length > 0) {
      stopReason = 'tool_use';
    } else if (finishReason === 'MAX_TOKENS') {
      stopReason = 'max_tokens';
    } else {
      stopReason = 'end_turn';
    }

    return {
      content,
      toolCalls,
      tokenUsage: {
        input: data.usageMetadata?.promptTokenCount ?? 0,
        output: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
      stopReason,
    };
  }
}
