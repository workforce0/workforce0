import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModelRegistryService } from '../model-registry.service.js';
import { encrypt } from '../../../lib/encryption.js';
import { getEncryptionKey } from '../../../config/index.js';

describe('ModelRegistryService', () => {
  let service: ModelRegistryService;
  let mockPrisma: any;

  beforeEach(() => {
    let providerCounter = 0;
    let modelConfigCounter = 0;

    mockPrisma = {
      modelProvider: {
        findMany: vi.fn(),
        create: vi.fn(),
        upsert: vi.fn().mockImplementation(() =>
          Promise.resolve({ id: `provider-${++providerCounter}` }),
        ),
      },
      modelConfig: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        upsert: vi.fn().mockImplementation(() =>
          Promise.resolve({ id: `model-config-${++modelConfigCounter}` }),
        ),
      },
      agentConfig: {
        findUnique: vi.fn(),
        upsert: vi.fn().mockImplementation(() =>
          Promise.resolve({ id: `agent-config-1` }),
        ),
        findMany: vi.fn(),
      },
    };
    service = new ModelRegistryService(mockPrisma);
  });

  it('should resolve model for agent type using tenant config', async () => {
    mockPrisma.agentConfig.findUnique.mockResolvedValue({
      primaryModelId: 'model-1',
      reviewerModelIds: ['model-2'],
      confidenceThreshold: 0.85,
      maxSteps: 25,
    });
    mockPrisma.modelConfig.findFirst.mockResolvedValue({
      id: 'model-1',
      modelId: 'claude-sonnet-4',
      provider: { name: 'anthropic', baseUrl: null, apiKeyEnc: 'encrypted' },
    });

    const result = await service.resolveModel('tenant-1', 'ba_agent');
    expect(result.modelId).toBe('claude-sonnet-4');
    expect(result.provider).toBe('anthropic');
  });

  it('should fall back to defaults when tenant has no config', async () => {
    mockPrisma.agentConfig.findUnique.mockResolvedValue(null);
    const result = await service.resolveModel('tenant-1', 'ba_agent');
    expect(result.modelId).toBe('gemini-2.0-flash-thinking');
    expect(result.provider).toBe('google');
  });

  it('should seed default models for new tenant', async () => {
    await service.seedDefaults('tenant-1');
    expect(mockPrisma.modelProvider.upsert).toHaveBeenCalled();
    expect(mockPrisma.agentConfig.upsert).toHaveBeenCalled();
  });

  it('should return fallback chain for agent', async () => {
    const chain = service.getFallbackChain('dev_agent');
    expect(chain.length).toBeGreaterThanOrEqual(2);
    expect(chain[0].provider).toBe('anthropic');
  });

  it('should resolve reviewers for agent type using tenant config', async () => {
    mockPrisma.agentConfig.findUnique.mockResolvedValue({
      primaryModelId: 'model-1',
      reviewerModelIds: ['model-2', 'model-3'],
      confidenceThreshold: 0.9,
      maxSteps: 50,
    });
    mockPrisma.modelConfig.findFirst
      .mockResolvedValueOnce({
        id: 'model-2',
        modelId: 'gemini-2.0-flash-thinking',
        provider: { name: 'google', baseUrl: null, apiKeyEnc: 'enc-key-2' },
      })
      .mockResolvedValueOnce({
        id: 'model-3',
        modelId: 'o1',
        provider: { name: 'openai', baseUrl: null, apiKeyEnc: 'enc-key-3' },
      });

    const reviewers = await service.resolveReviewers('tenant-1', 'dev_agent');
    expect(reviewers).toHaveLength(2);
    expect(reviewers[0].modelId).toBe('gemini-2.0-flash-thinking');
    expect(reviewers[0].provider).toBe('google');
    expect(reviewers[1].modelId).toBe('o1');
    expect(reviewers[1].provider).toBe('openai');
  });

  it('should fall back to default reviewers when tenant has no config', async () => {
    mockPrisma.agentConfig.findUnique.mockResolvedValue(null);
    const reviewers = await service.resolveReviewers('tenant-1', 'dev_agent');
    expect(reviewers).toHaveLength(2);
    expect(reviewers[0].modelId).toBe('gemini-2.0-flash-thinking');
    expect(reviewers[0].provider).toBe('google');
    expect(reviewers[1].modelId).toBe('o1');
    expect(reviewers[1].provider).toBe('openai');
  });

  it('should return empty reviewers for agents with no reviewers configured', async () => {
    mockPrisma.agentConfig.findUnique.mockResolvedValue(null);
    const reviewers = await service.resolveReviewers('tenant-1', 'meeting_brain');
    expect(reviewers).toHaveLength(0);
  });

  it('should include confidence and maxSteps from tenant config in resolved model', async () => {
    const plainApiKey = 'sk-ant-test-key-12345';
    const encryptedApiKey = encrypt(plainApiKey, getEncryptionKey());

    mockPrisma.agentConfig.findUnique.mockResolvedValue({
      primaryModelId: 'model-1',
      reviewerModelIds: [],
      confidenceThreshold: 0.95,
      maxSteps: 40,
    });
    mockPrisma.modelConfig.findFirst.mockResolvedValue({
      id: 'model-1',
      modelId: 'claude-sonnet-4',
      provider: { name: 'anthropic', baseUrl: 'https://custom.api', apiKeyEnc: encryptedApiKey },
    });

    const result = await service.resolveModel('tenant-1', 'dev_agent');
    expect(result.confidenceThreshold).toBe(0.95);
    expect(result.maxSteps).toBe(40);
    expect(result.baseUrl).toBe('https://custom.api');
    expect(result.apiKeyEnc).toBe(plainApiKey);
  });

  it('should include confidence and maxSteps from defaults when no tenant config', async () => {
    mockPrisma.agentConfig.findUnique.mockResolvedValue(null);
    const result = await service.resolveModel('tenant-1', 'dev_agent');
    expect(result.confidenceThreshold).toBe(0.9);
    expect(result.maxSteps).toBe(50);
  });

  it('should seed all 3 default providers', async () => {
    await service.seedDefaults('tenant-1');
    // 3 providers: anthropic, google, openai
    expect(mockPrisma.modelProvider.upsert).toHaveBeenCalledTimes(3);
  });

  it('should seed agent configs for all 7 agent types', async () => {
    await service.seedDefaults('tenant-1');
    // 7 agent types (meeting_brain, ba_agent, dev_agent, qa_agent,
    // supervisor, memory_optimizer, chief_of_staff — M7.4).
    expect(mockPrisma.agentConfig.upsert).toHaveBeenCalledTimes(7);
  });

  it('should pass capabilities, residency, and reviewerModelIds as arrays, not stringified JSON', async () => {
    await service.seedDefaults('tenant-1');

    // Check modelConfig.upsert calls — capabilities and residency must be plain arrays
    for (const call of mockPrisma.modelConfig.upsert.mock.calls) {
      const createArg = call[0].create;
      expect(Array.isArray(createArg.capabilities)).toBe(true);
      expect(typeof createArg.capabilities).not.toBe('string');
      expect(createArg.capabilities).toEqual(['reasoning', 'code', 'analysis']);

      expect(Array.isArray(createArg.residency)).toBe(true);
      expect(typeof createArg.residency).not.toBe('string');
      expect(createArg.residency).toEqual(['us']);
    }

    // Check agentConfig.upsert calls — reviewerModelIds must be a plain array
    for (const call of mockPrisma.agentConfig.upsert.mock.calls) {
      const createArg = call[0].create;
      expect(Array.isArray(createArg.reviewerModelIds)).toBe(true);
      expect(typeof createArg.reviewerModelIds).not.toBe('string');
    }
  });

  it('should return fallback chain starting with primary provider for supervisor', async () => {
    const chain = service.getFallbackChain('supervisor');
    expect(chain[0].provider).toBe('google');
    // fallback chain for google provider starts with anthropic, then openai
    expect(chain[1].provider).toBe('anthropic');
    expect(chain[2].provider).toBe('openai');
  });

  // ---- Custom/Open-Source Model Support ----

  describe('registerCustomModel', () => {
    it('should register a custom model with encrypted API key', async () => {
      mockPrisma.modelProvider.upsert.mockResolvedValue({ id: 'custom-provider-1' });
      mockPrisma.modelProvider.update = vi.fn().mockResolvedValue({});
      mockPrisma.modelConfig.upsert.mockResolvedValue({ id: 'custom-model-1' });

      const result = await service.registerCustomModel(
        'tenant-1',
        'llama-3.1-70b',
        'Llama 3.1 70B',
        'https://api.together.xyz',
        'sk-together-key-123',
      );

      expect(result.providerId).toBe('custom-provider-1');
      expect(result.modelConfigId).toBe('custom-model-1');

      // Verify provider was upserted as 'custom'
      expect(mockPrisma.modelProvider.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId_name: { tenantId: 'tenant-1', name: 'custom' } },
        }),
      );

      // Verify API key was encrypted
      expect(mockPrisma.modelProvider.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            apiKeyEnc: expect.any(String),
          }),
        }),
      );
    });

    it('should accept custom capabilities and context window', async () => {
      mockPrisma.modelProvider.upsert.mockResolvedValue({ id: 'custom-provider-1' });
      mockPrisma.modelProvider.update = vi.fn().mockResolvedValue({});
      mockPrisma.modelConfig.upsert.mockResolvedValue({ id: 'custom-model-1' });

      await service.registerCustomModel(
        'tenant-1',
        'mistral-large',
        'Mistral Large',
        'https://api.mistral.ai',
        'sk-mistral-key',
        {
          capabilities: ['code', 'reasoning', 'fast'],
          maxContext: 128000,
          costInput: 0.002,
          costOutput: 0.006,
        },
      );

      expect(mockPrisma.modelConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            capabilities: ['code', 'reasoning', 'fast'],
            maxContext: 128000,
            costInput: 0.002,
            costOutput: 0.006,
          }),
        }),
      );
    });
  });

  describe('listCustomModels', () => {
    it('should return empty array when no custom provider exists', async () => {
      mockPrisma.modelProvider.findUnique = vi.fn().mockResolvedValue(null);
      const models = await service.listCustomModels('tenant-1');
      expect(models).toEqual([]);
    });

    it('should return custom models for tenant', async () => {
      mockPrisma.modelProvider.findUnique = vi.fn().mockResolvedValue({
        id: 'custom-provider-1',
        baseUrl: 'https://api.together.xyz',
      });
      mockPrisma.modelConfig.findMany.mockResolvedValue([
        {
          modelId: 'llama-3.1-70b',
          displayName: 'Llama 3.1 70B',
          capabilities: ['reasoning', 'code'],
          isActive: true,
        },
        {
          modelId: 'mistral-large',
          displayName: 'Mistral Large',
          capabilities: ['code', 'fast'],
          isActive: true,
        },
      ]);

      const models = await service.listCustomModels('tenant-1');
      expect(models).toHaveLength(2);
      expect(models[0].modelId).toBe('llama-3.1-70b');
      expect(models[0].baseUrl).toBe('https://api.together.xyz');
    });
  });

  describe('assignCustomModelToAgent', () => {
    it('should assign a custom model to an agent with preset=custom', async () => {
      await service.assignCustomModelToAgent('tenant-1', 'dev_agent', 'custom-model-1', {
        confidenceThreshold: 0.8,
        maxSteps: 30,
      });

      expect(mockPrisma.agentConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId_agentType: { tenantId: 'tenant-1', agentType: 'dev_agent' } },
          create: expect.objectContaining({
            preset: 'custom',
            primaryModelId: 'custom-model-1',
            maxSteps: 30,
            confidenceThreshold: 0.8,
          }),
        }),
      );
    });
  });
});
