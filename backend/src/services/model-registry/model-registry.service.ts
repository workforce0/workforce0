// mvp/src/services/model-registry/model-registry.service.ts
import { logger } from '../../lib/logger.js';
import { encrypt, decrypt } from '../../lib/encryption.js';
import { getEncryptionKey } from '../../config/index.js';
import type { AgentType, ProviderName } from '../../types/model-registry.types.js';
import {
  DEFAULT_MODEL_ASSIGNMENTS,
  FALLBACK_CHAINS,
} from './default-models.js';

export interface ResolvedModel {
  modelId: string;
  provider: ProviderName;
  baseUrl?: string;
  apiKeyEnc?: string;
  confidenceThreshold: number;
  maxSteps: number;
}

const log = logger.child({ service: 'ModelRegistryService' });

export class ModelRegistryService {
  constructor(private readonly prisma: any) {}

  /**
   * Decrypt an apiKeyEnc value, returning undefined if no encrypted key is stored.
   */
  private decryptApiKey(apiKeyEnc: string | null | undefined): string | undefined {
    if (!apiKeyEnc) return undefined;
    try {
      return decrypt(apiKeyEnc, getEncryptionKey());
    } catch (err) {
      log.error({ err }, 'Failed to decrypt API key — returning undefined');
      return undefined;
    }
  }

  /**
   * Encrypt and store an API key for a provider.
   *
   * @param tenantId - The tenant that owns the provider
   * @param providerName - The provider name (e.g. "anthropic", "openai")
   * @param apiKey - The plaintext API key to encrypt and store
   */
  async storeProviderKey(tenantId: string, providerName: string, apiKey: string): Promise<void> {
    const encryptedKey = encrypt(apiKey, getEncryptionKey());

    await this.prisma.modelProvider.update({
      where: { tenantId_name: { tenantId, name: providerName } },
      data: { apiKeyEnc: encryptedKey },
    });

    log.info({ tenantId, provider: providerName }, 'Provider API key encrypted and stored');
  }

  /**
   * Retrieve and decrypt the API key for a provider.
   *
   * @param tenantId - The tenant that owns the provider
   * @param providerName - The provider name
   * @returns The decrypted API key, or undefined if none is stored
   */
  async getProviderKey(tenantId: string, providerName: string): Promise<string | undefined> {
    const provider = await this.prisma.modelProvider.findUnique({
      where: { tenantId_name: { tenantId, name: providerName } },
    });

    if (!provider) {
      log.warn({ tenantId, provider: providerName }, 'Provider not found');
      return undefined;
    }

    return this.decryptApiKey(provider.apiKeyEnc);
  }

  /**
   * Resolve the primary model for a given tenant and agent type.
   * Checks tenant-specific AgentConfig first, falls back to defaults.
   */
  async resolveModel(tenantId: string, agentType: AgentType): Promise<ResolvedModel> {
    const agentConfig = await this.prisma.agentConfig.findUnique({
      where: { tenantId_agentType: { tenantId, agentType } },
    });

    if (agentConfig) {
      log.debug({ tenantId, agentType }, 'Found tenant agent config');

      const modelConfig = await this.prisma.modelConfig.findFirst({
        where: { id: agentConfig.primaryModelId },
        include: { provider: true },
      });

      if (modelConfig) {
        return {
          modelId: modelConfig.modelId,
          provider: modelConfig.provider.name as ProviderName,
          baseUrl: modelConfig.provider.baseUrl ?? undefined,
          apiKeyEnc: this.decryptApiKey(modelConfig.provider.apiKeyEnc),
          confidenceThreshold: agentConfig.confidenceThreshold,
          maxSteps: agentConfig.maxSteps,
        };
      }

      log.warn(
        { tenantId, agentType, primaryModelId: agentConfig.primaryModelId },
        'Agent config references missing model, falling back to defaults',
      );
    }

    // Fall back to defaults
    const defaultAssignment = DEFAULT_MODEL_ASSIGNMENTS.find(
      (a) => a.agentType === agentType,
    );

    if (!defaultAssignment) {
      throw new Error(`No default model assignment found for agent type: ${agentType}`);
    }

    log.debug({ tenantId, agentType }, 'Using default model assignment');

    return {
      modelId: defaultAssignment.primaryModelId,
      provider: defaultAssignment.primaryProvider,
      confidenceThreshold: defaultAssignment.confidenceThreshold,
      maxSteps: defaultAssignment.maxSteps,
    };
  }

  /**
   * Resolve the reviewer models for a given tenant and agent type.
   * Checks tenant-specific AgentConfig first, falls back to defaults.
   */
  async resolveReviewers(tenantId: string, agentType: AgentType): Promise<ResolvedModel[]> {
    const agentConfig = await this.prisma.agentConfig.findUnique({
      where: { tenantId_agentType: { tenantId, agentType } },
    });

    if (agentConfig) {
      const reviewerModelIds = agentConfig.reviewerModelIds as string[];
      if (!reviewerModelIds || reviewerModelIds.length === 0) {
        return [];
      }

      const reviewers: ResolvedModel[] = [];
      for (const modelId of reviewerModelIds) {
        const modelConfig = await this.prisma.modelConfig.findFirst({
          where: { id: modelId },
          include: { provider: true },
        });

        if (modelConfig) {
          reviewers.push({
            modelId: modelConfig.modelId,
            provider: modelConfig.provider.name as ProviderName,
            baseUrl: modelConfig.provider.baseUrl ?? undefined,
            apiKeyEnc: this.decryptApiKey(modelConfig.provider.apiKeyEnc),
            confidenceThreshold: agentConfig.confidenceThreshold,
            maxSteps: agentConfig.maxSteps,
          });
        }
      }

      return reviewers;
    }

    // Fall back to defaults
    const defaultAssignment = DEFAULT_MODEL_ASSIGNMENTS.find(
      (a) => a.agentType === agentType,
    );

    if (!defaultAssignment || defaultAssignment.reviewers.length === 0) {
      return [];
    }

    return defaultAssignment.reviewers.map((r) => ({
      modelId: r.modelId,
      provider: r.provider,
      confidenceThreshold: defaultAssignment.confidenceThreshold,
      maxSteps: defaultAssignment.maxSteps,
    }));
  }

  /**
   * Get the fallback chain for an agent type.
   * Returns the primary model followed by fallback providers.
   */
  getFallbackChain(agentType: AgentType): Array<{ provider: ProviderName; modelId: string }> {
    const defaultAssignment = DEFAULT_MODEL_ASSIGNMENTS.find(
      (a) => a.agentType === agentType,
    );

    if (!defaultAssignment) {
      throw new Error(`No default model assignment found for agent type: ${agentType}`);
    }

    const primaryProvider = defaultAssignment.primaryProvider;
    const chain: Array<{ provider: ProviderName; modelId: string }> = [
      { provider: primaryProvider, modelId: defaultAssignment.primaryModelId },
    ];

    const fallbacks = FALLBACK_CHAINS[primaryProvider];
    if (fallbacks) {
      chain.push(...fallbacks);
    }

    return chain;
  }

  /**
   * Register a custom/open-source model for a tenant.
   *
   * Allows tenants to bring their own models (Llama, Mistral, etc.) by
   * providing an OpenAI-compatible API endpoint. The model is accessible
   * via the 'custom' provider and can be assigned to any agent.
   *
   * @param tenantId    - The tenant registering the model
   * @param modelId     - A unique model identifier (e.g., "llama-3.1-70b")
   * @param displayName - Human-readable name shown in the UI
   * @param baseUrl     - OpenAI-compatible API endpoint (e.g., "https://api.together.xyz")
   * @param apiKey      - API key for the endpoint (will be encrypted at rest)
   * @param options     - Optional capabilities, context window, etc.
   * @returns The created ModelConfig record
   */
  async registerCustomModel(
    tenantId: string,
    modelId: string,
    displayName: string,
    baseUrl: string,
    apiKey: string,
    options?: {
      capabilities?: string[];
      maxContext?: number;
      costInput?: number;
      costOutput?: number;
      supportsTools?: boolean;
      supportsStreaming?: boolean;
      residency?: string[];
    },
  ): Promise<{ providerId: string; modelConfigId: string }> {
    // Upsert the custom provider for this tenant with the given baseUrl
    const provider = await this.prisma.modelProvider.upsert({
      where: { tenantId_name: { tenantId, name: 'custom' } },
      update: { baseUrl, isActive: true },
      create: {
        tenantId,
        name: 'custom',
        baseUrl,
        isActive: true,
      },
    });

    // Encrypt and store the API key
    const encryptedKey = encrypt(apiKey, getEncryptionKey());
    await this.prisma.modelProvider.update({
      where: { id: provider.id },
      data: { apiKeyEnc: encryptedKey },
    });

    // Create the model config
    const modelConfig = await this.prisma.modelConfig.upsert({
      where: {
        tenantId_providerId_modelId: {
          tenantId,
          providerId: provider.id,
          modelId,
        },
      },
      update: {
        displayName,
        capabilities: options?.capabilities || ['reasoning', 'code'],
        maxContext: options?.maxContext || 32000,
        costInput: options?.costInput || 0,
        costOutput: options?.costOutput || 0,
        supportsTools: options?.supportsTools ?? true,
        supportsStreaming: options?.supportsStreaming ?? true,
        residency: options?.residency || ['us'],
        isActive: true,
      },
      create: {
        tenantId,
        providerId: provider.id,
        modelId,
        displayName,
        capabilities: options?.capabilities || ['reasoning', 'code'],
        maxContext: options?.maxContext || 32000,
        costInput: options?.costInput || 0,
        costOutput: options?.costOutput || 0,
        supportsTools: options?.supportsTools ?? true,
        supportsStreaming: options?.supportsStreaming ?? true,
        residency: options?.residency || ['us'],
        isActive: true,
      },
    });

    log.info(
      { tenantId, modelId, displayName, baseUrl: baseUrl.replace(/\/.*@/, '/***@') },
      'Custom model registered',
    );

    return { providerId: provider.id, modelConfigId: modelConfig.id };
  }

  /**
   * List all custom models registered by a tenant.
   */
  async listCustomModels(tenantId: string): Promise<Array<{
    modelId: string;
    displayName: string;
    baseUrl: string | null;
    capabilities: unknown;
    isActive: boolean;
  }>> {
    const provider = await this.prisma.modelProvider.findUnique({
      where: { tenantId_name: { tenantId, name: 'custom' } },
    });

    if (!provider) return [];

    const models = await this.prisma.modelConfig.findMany({
      where: { tenantId, providerId: provider.id },
    });

    return models.map((m: any) => ({
      modelId: m.modelId,
      displayName: m.displayName,
      baseUrl: provider.baseUrl,
      capabilities: m.capabilities,
      isActive: m.isActive,
    }));
  }

  /**
   * Assign a custom model as the primary model for an agent.
   */
  async assignCustomModelToAgent(
    tenantId: string,
    agentType: AgentType,
    modelConfigId: string,
    options?: { confidenceThreshold?: number; maxSteps?: number },
  ): Promise<void> {
    await this.prisma.agentConfig.upsert({
      where: { tenantId_agentType: { tenantId, agentType } },
      update: {
        primaryModelId: modelConfigId,
        preset: 'custom',
        ...(options?.confidenceThreshold !== undefined && { confidenceThreshold: options.confidenceThreshold }),
        ...(options?.maxSteps !== undefined && { maxSteps: options.maxSteps }),
      },
      create: {
        tenantId,
        agentType,
        preset: 'custom',
        primaryModelId: modelConfigId,
        reviewerModelIds: [],
        maxSteps: options?.maxSteps || 25,
        confidenceThreshold: options?.confidenceThreshold || 0.85,
        isActive: true,
      },
    });

    log.info({ tenantId, agentType, modelConfigId }, 'Custom model assigned to agent');
  }

  /**
   * Seed default providers and agent configs for a new tenant.
   * Uses upsert to be idempotent.
   */
  async seedDefaults(tenantId: string): Promise<void> {
    log.info({ tenantId }, 'Seeding default model registry for tenant');

    // Collect unique providers from default assignments
    const providerNames = new Set<ProviderName>();
    for (const assignment of DEFAULT_MODEL_ASSIGNMENTS) {
      providerNames.add(assignment.primaryProvider);
      for (const reviewer of assignment.reviewers) {
        providerNames.add(reviewer.provider);
      }
    }

    // Upsert providers
    const providerIdMap = new Map<ProviderName, string>();
    for (const providerName of providerNames) {
      const provider = await this.prisma.modelProvider.upsert({
        where: { tenantId_name: { tenantId, name: providerName } },
        update: {},
        create: {
          tenantId,
          name: providerName,
          isActive: true,
        },
      });
      providerIdMap.set(providerName as ProviderName, provider.id);
    }

    // Upsert model configs for each default assignment's primary and reviewer models
    const modelConfigIdMap = new Map<string, string>();

    for (const assignment of DEFAULT_MODEL_ASSIGNMENTS) {
      // Primary model
      const primaryKey = `${assignment.primaryProvider}:${assignment.primaryModelId}`;
      if (!modelConfigIdMap.has(primaryKey)) {
        const providerId = providerIdMap.get(assignment.primaryProvider)!;
        const config = await this.prisma.modelConfig.upsert({
          where: {
            tenantId_providerId_modelId: {
              tenantId,
              providerId,
              modelId: assignment.primaryModelId,
            },
          },
          update: {},
          create: {
            tenantId,
            providerId,
            modelId: assignment.primaryModelId,
            displayName: assignment.primaryModelId,
            capabilities: ['reasoning', 'code', 'analysis'],
            costInput: 0,
            costOutput: 0,
            maxContext: 128000,
            supportsTools: true,
            supportsStreaming: true,
            residency: ['us'],
            isActive: true,
          },
        });
        modelConfigIdMap.set(primaryKey, config.id);
      }

      // Reviewer models
      for (const reviewer of assignment.reviewers) {
        const reviewerKey = `${reviewer.provider}:${reviewer.modelId}`;
        if (!modelConfigIdMap.has(reviewerKey)) {
          const providerId = providerIdMap.get(reviewer.provider)!;
          const config = await this.prisma.modelConfig.upsert({
            where: {
              tenantId_providerId_modelId: {
                tenantId,
                providerId,
                modelId: reviewer.modelId,
              },
            },
            update: {},
            create: {
              tenantId,
              providerId,
              modelId: reviewer.modelId,
              displayName: reviewer.modelId,
              capabilities: ['reasoning', 'code', 'analysis'],
              costInput: 0,
              costOutput: 0,
              maxContext: 128000,
              supportsTools: true,
              supportsStreaming: true,
              residency: ['us'],
              isActive: true,
            },
          });
          modelConfigIdMap.set(reviewerKey, config.id);
        }
      }
    }

    // Upsert agent configs
    for (const assignment of DEFAULT_MODEL_ASSIGNMENTS) {
      const primaryKey = `${assignment.primaryProvider}:${assignment.primaryModelId}`;
      const primaryModelConfigId = modelConfigIdMap.get(primaryKey)!;

      const reviewerModelConfigIds = assignment.reviewers.map((r) => {
        const key = `${r.provider}:${r.modelId}`;
        return modelConfigIdMap.get(key)!;
      });

      await this.prisma.agentConfig.upsert({
        where: { tenantId_agentType: { tenantId, agentType: assignment.agentType } },
        update: {},
        create: {
          tenantId,
          agentType: assignment.agentType,
          preset: 'recommended',
          primaryModelId: primaryModelConfigId,
          reviewerModelIds: reviewerModelConfigIds,
          maxSteps: assignment.maxSteps,
          confidenceThreshold: assignment.confidenceThreshold,
          isActive: true,
        },
      });
    }

    log.info(
      { tenantId, providers: [...providerNames], agents: DEFAULT_MODEL_ASSIGNMENTS.length },
      'Default model registry seeded',
    );
  }
}
