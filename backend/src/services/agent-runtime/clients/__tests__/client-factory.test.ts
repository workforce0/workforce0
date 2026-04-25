// mvp/src/services/agent-runtime/clients/__tests__/client-factory.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createModelClient } from '../client-factory.js';
import { PromptPipeline } from '../../prompt-pipeline.js';

describe('ClientFactory', () => {
  it('should create anthropic client', () => {
    const client = createModelClient('anthropic', { apiKey: 'test' });
    expect(client).toBeDefined();
    expect(client.chat).toBeTypeOf('function');
  });

  it('should create google client', () => {
    const client = createModelClient('google', { apiKey: 'test' });
    expect(client).toBeDefined();
    expect(client.chat).toBeTypeOf('function');
  });

  it('should create openai client', () => {
    const client = createModelClient('openai', { apiKey: 'test' });
    expect(client).toBeDefined();
    expect(client.chat).toBeTypeOf('function');
  });

  it('should create ollama client (OpenAI-compatible, default baseUrl)', () => {
    // Ollama is wired into the union but routes through OpenAIClient with a
    // pointed baseUrl. apiKey is optional for Ollama.
    const client = createModelClient('ollama', { baseUrl: 'http://ollama:11434' });
    expect(client).toBeDefined();
    expect(client.chat).toBeTypeOf('function');
  });

  it('should create ollama client without explicit baseUrl (falls back to compose default)', () => {
    const client = createModelClient('ollama', {});
    expect(client).toBeDefined();
    expect(client.chat).toBeTypeOf('function');
  });

  it('should create custom client with baseUrl (uses OpenAI-compatible API)', () => {
    const client = createModelClient('custom', { apiKey: 'test', baseUrl: 'http://localhost:8080' });
    expect(client).toBeDefined();
    expect(client.chat).toBeTypeOf('function');
  });

  it('should create meta client with baseUrl (uses OpenAI-compatible API)', () => {
    const client = createModelClient('meta', { apiKey: 'test', baseUrl: 'http://localhost:8080' });
    expect(client).toBeDefined();
    expect(client.chat).toBeTypeOf('function');
  });

  it('should throw for custom provider without baseUrl', () => {
    expect(() => createModelClient('custom', {})).toThrow();
  });

  it('should throw for meta provider without baseUrl', () => {
    expect(() => createModelClient('meta', {})).toThrow();
  });

  it('should throw for unknown provider', () => {
    expect(() => createModelClient('unknown' as any, {})).toThrow('Unknown provider');
  });

  it('wraps the client with PromptPipeline when pipeline option is provided', () => {
    const pipeline = new PromptPipeline({ redact: false });
    const wrapSpy = vi.spyOn(pipeline, 'wrap');
    const client = createModelClient('anthropic', { apiKey: 'test', pipeline });
    expect(wrapSpy).toHaveBeenCalledTimes(1);
    expect(client).toBeDefined();
    expect(client.chat).toBeTypeOf('function');
  });

  it('returns raw client (not wrapped) when no pipeline given', () => {
    const pipeline = new PromptPipeline({ redact: false });
    const wrapSpy = vi.spyOn(pipeline, 'wrap');
    createModelClient('google', { apiKey: 'test' });
    expect(wrapSpy).not.toHaveBeenCalled();
  });
});
