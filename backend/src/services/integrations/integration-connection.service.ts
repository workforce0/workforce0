/**
 * =============================================================================
 * INTEGRATION CONNECTION SERVICE — BYOK Credential Vault
 * =============================================================================
 *
 * Stores per-tenant integration credentials (Jira API tokens, Slack bot
 * tokens, GitHub PATs, etc.) encrypted at rest. The in-app integration
 * wizards POST here via `/integrations/:name/connect`; running integrations
 * read credentials via `getDecryptedCredentials()`.
 *
 * Encryption: AES-256-GCM via lib/encryption.ts, with a key derived from
 * JWT_SECRET (or ENCRYPTION_KEY when explicitly set).
 *
 * @module services/integrations/integration-connection
 */
import type { PrismaClient, IntegrationConnection } from '../../../prisma/generated/client/index.js';
import { createChildLogger } from '../../lib/logger.js';
import { encrypt, decrypt, deriveKey } from '../../lib/encryption.js';

export type IntegrationName =
  | 'jira'
  | 'slack'
  | 'github'
  | 'linear'
  | 'notion'
  | 'gchat'
  | 'gdocs'
  | 'gdrive'
  | 'twilio';

export type ConnectionStatus = 'disconnected' | 'connected' | 'action_needed' | 'error';

export interface ConnectInput {
  tenantId: string;
  name: IntegrationName;
  credentials: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  connectedBy?: string;
}

export interface PublicConnection {
  name: IntegrationName;
  status: ConnectionStatus;
  metadata: Record<string, unknown>;
  lastTestedAt: Date | null;
  lastError: string | null;
  connectedBy: string | null;
  updatedAt: Date;
}

/**
 * Tester callback signature. Each integration registers a tester that takes
 * the decrypted credentials and returns a success/failure plus optional
 * metadata (e.g., connected email, default project).
 */
export type IntegrationTester = (
  credentials: Record<string, unknown>,
) => Promise<{ ok: true; metadata?: Record<string, unknown> } | { ok: false; error: string }>;

export class IntegrationConnectionService {
  private readonly logger = createChildLogger({ service: 'IntegrationConnectionService' });
  private readonly keyHex: string;
  private readonly testers = new Map<IntegrationName, IntegrationTester>();

  constructor(private readonly prisma: PrismaClient, encryptionKey: string) {
    if (encryptionKey.length === 64) {
      this.keyHex = encryptionKey;
    } else {
      this.keyHex = deriveKey(encryptionKey).toString('hex');
    }
  }

  registerTester(name: IntegrationName, tester: IntegrationTester): void {
    this.testers.set(name, tester);
  }

  async connect(input: ConnectInput): Promise<PublicConnection> {
    const ciphertext = encrypt(JSON.stringify(input.credentials), this.keyHex);
    const record = await this.prisma.integrationConnection.upsert({
      where: { tenantId_name: { tenantId: input.tenantId, name: input.name } },
      update: {
        credentials: ciphertext,
        metadata: (input.metadata ?? {}) as any,
        status: 'connected',
        connectedBy: input.connectedBy,
        lastTestedAt: new Date(),
        lastError: null,
      },
      create: {
        tenantId: input.tenantId,
        name: input.name,
        credentials: ciphertext,
        metadata: (input.metadata ?? {}) as any,
        status: 'connected',
        connectedBy: input.connectedBy,
        lastTestedAt: new Date(),
      },
    });
    this.logger.info('Integration connected', { tenantId: input.tenantId, name: input.name });
    return this.toPublic(record);
  }

  async disconnect(tenantId: string, name: IntegrationName): Promise<void> {
    await this.prisma.integrationConnection.deleteMany({ where: { tenantId, name } });
    this.logger.info('Integration disconnected', { tenantId, name });
  }

  async listAll(tenantId: string): Promise<PublicConnection[]> {
    const records = await this.prisma.integrationConnection.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
    });
    return records.map((r) => this.toPublic(r));
  }

  async get(tenantId: string, name: IntegrationName): Promise<PublicConnection | null> {
    const record = await this.prisma.integrationConnection.findUnique({
      where: { tenantId_name: { tenantId, name } },
    });
    return record ? this.toPublic(record) : null;
  }

  async getDecryptedCredentials(
    tenantId: string,
    name: IntegrationName,
  ): Promise<Record<string, unknown> | null> {
    const record = await this.prisma.integrationConnection.findUnique({
      where: { tenantId_name: { tenantId, name } },
    });
    if (!record || !record.credentials) return null;
    try {
      return JSON.parse(decrypt(record.credentials, this.keyHex));
    } catch (err) {
      this.logger.error('Failed to decrypt credentials', {
        tenantId,
        name,
        error: (err as Error).message,
      });
      return null;
    }
  }

  async testConnection(
    tenantId: string,
    name: IntegrationName,
    credentials?: Record<string, unknown>,
  ): Promise<{ ok: boolean; error?: string; metadata?: Record<string, unknown> }> {
    const tester = this.testers.get(name);
    if (!tester) {
      return { ok: false, error: `No tester registered for ${name}` };
    }

    const creds = credentials ?? (await this.getDecryptedCredentials(tenantId, name));
    if (!creds) {
      return { ok: false, error: 'No credentials available to test' };
    }

    const result = await tester(creds);
    await this.prisma.integrationConnection.updateMany({
      where: { tenantId, name },
      data: {
        lastTestedAt: new Date(),
        status: result.ok ? 'connected' : 'action_needed',
        lastError: result.ok ? null : result.error,
        metadata: result.ok && result.metadata ? (result.metadata as any) : undefined,
      },
    });
    return result.ok ? { ok: true, metadata: result.metadata } : { ok: false, error: result.error };
  }

  private toPublic(record: IntegrationConnection): PublicConnection {
    return {
      name: record.name as IntegrationName,
      status: record.status as ConnectionStatus,
      metadata: (record.metadata as Record<string, unknown>) ?? {},
      lastTestedAt: record.lastTestedAt,
      lastError: record.lastError,
      connectedBy: record.connectedBy,
      updatedAt: record.updatedAt,
    };
  }
}
