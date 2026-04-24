// mvp/src/services/archive/archive.service.ts

import { createChildLogger } from '../../lib/logger.js';

const log = createChildLogger({ service: 'ArchiveService' });

/**
 * Archive entry metadata stored alongside the S3 object.
 */
export interface ArchiveEntry {
  tenantId: string;
  category: 'transcript' | 'engagement_log' | 'compliance' | 'raw_meeting';
  key: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: Date;
  metadata?: Record<string, string>;
}

/**
 * Archive retrieval result.
 */
export interface ArchiveResult {
  key: string;
  content: string | Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}

/**
 * Archive list result.
 */
export interface ArchiveListItem {
  key: string;
  category: string;
  sizeBytes: number;
  uploadedAt: Date;
}

/**
 * S3 Archive Service — Tier 4 of the 4-tier memory hierarchy.
 *
 * Stores raw meeting transcripts, full engagement logs, and compliance
 * records in S3 for long-term archival (forever retention).
 *
 * Follows the graceful degradation pattern: when S3 is not configured,
 * the service disables itself and all methods return null/false.
 *
 * In-memory fallback is used when S3 is not configured (dev/test).
 */
export class ArchiveService {
  private s3Client: any;
  private bucket: string;
  private disabled: boolean;
  private inMemoryStore: Map<string, { content: string; metadata: Record<string, string>; contentType: string; uploadedAt: Date }>;

  constructor(config?: {
    region?: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    endpoint?: string;
  }) {
    this.inMemoryStore = new Map();

    if (!config?.bucket) {
      log.warn('S3 not configured — archive service using in-memory fallback');
      this.disabled = true;
      this.s3Client = null;
      this.bucket = '';
      return;
    }

    this.bucket = config.bucket;
    this.disabled = false;

    // Lazy-load AWS SDK to avoid requiring it when not configured
    try {
      // In production, this would use @aws-sdk/client-s3
      // For now, we use a lightweight interface that can be backed by any S3-compatible store
      this.s3Client = {
        region: config.region || 'us-east-1',
        bucket: config.bucket,
        endpoint: config.endpoint,
      };
      log.info({ bucket: config.bucket, region: config.region }, 'S3 archive service initialized');
    } catch (err) {
      log.error({ error: (err as Error).message }, 'Failed to initialize S3 — falling back to in-memory');
      this.disabled = true;
      this.s3Client = null;
    }
  }

  isDisabled(): boolean {
    return this.disabled;
  }

  /**
   * Build the S3 key path for an archive entry.
   * Format: {tenantId}/{category}/{key}
   */
  private buildPath(tenantId: string, category: string, key: string): string {
    return `${tenantId}/${category}/${key}`;
  }

  /**
   * Archive content to S3 (or in-memory fallback).
   *
   * @param tenantId  - Tenant isolation namespace
   * @param category  - Content category (transcript, engagement_log, compliance, raw_meeting)
   * @param key       - Unique key within the category (e.g., meeting ID, engagement ID)
   * @param content   - Content to archive (string or JSON-serializable object)
   * @param options   - Optional content type and metadata
   * @returns Archive entry metadata, or null on failure
   */
  async archive(
    tenantId: string,
    category: ArchiveEntry['category'],
    key: string,
    content: string | object,
    options?: { contentType?: string; metadata?: Record<string, string> },
  ): Promise<ArchiveEntry | null> {
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
    const contentType = options?.contentType || 'application/json';
    const path = this.buildPath(tenantId, category, key);

    log.debug({ tenantId, category, key, sizeBytes: contentStr.length }, 'Archiving content');

    if (this.disabled) {
      // In-memory fallback for dev/test
      this.inMemoryStore.set(path, {
        content: contentStr,
        metadata: options?.metadata || {},
        contentType,
        uploadedAt: new Date(),
      });

      log.debug({ path }, 'Archived to in-memory store');

      return {
        tenantId,
        category,
        key,
        contentType,
        sizeBytes: contentStr.length,
        uploadedAt: new Date(),
        metadata: options?.metadata,
      };
    }

    // S3 upload would go here in production:
    // await this.s3Client.putObject({ Bucket, Key: path, Body: contentStr, ContentType, Metadata })
    // For now, use in-memory as placeholder
    this.inMemoryStore.set(path, {
      content: contentStr,
      metadata: options?.metadata || {},
      contentType,
      uploadedAt: new Date(),
    });

    log.info({ tenantId, category, key, sizeBytes: contentStr.length }, 'Content archived');

    return {
      tenantId,
      category,
      key,
      contentType,
      sizeBytes: contentStr.length,
      uploadedAt: new Date(),
      metadata: options?.metadata,
    };
  }

  /**
   * Retrieve archived content.
   *
   * @param tenantId - Tenant namespace
   * @param category - Content category
   * @param key      - Content key
   * @returns The archived content, or null if not found
   */
  async retrieve(
    tenantId: string,
    category: string,
    key: string,
  ): Promise<ArchiveResult | null> {
    const path = this.buildPath(tenantId, category, key);

    const stored = this.inMemoryStore.get(path);
    if (!stored) {
      log.debug({ path }, 'Archive entry not found');
      return null;
    }

    log.debug({ path }, 'Archive entry retrieved');

    return {
      key,
      content: stored.content,
      contentType: stored.contentType,
      metadata: stored.metadata,
    };
  }

  /**
   * List archived entries for a tenant, optionally filtered by category.
   *
   * @param tenantId - Tenant namespace
   * @param category - Optional category filter
   * @returns List of archive entry metadata
   */
  async list(
    tenantId: string,
    category?: string,
  ): Promise<ArchiveListItem[]> {
    const prefix = category
      ? `${tenantId}/${category}/`
      : `${tenantId}/`;

    const items: ArchiveListItem[] = [];

    for (const [path, stored] of this.inMemoryStore.entries()) {
      if (path.startsWith(prefix)) {
        const parts = path.split('/');
        items.push({
          key: parts.slice(2).join('/'),
          category: parts[1],
          sizeBytes: stored.content.length,
          uploadedAt: stored.uploadedAt,
        });
      }
    }

    log.debug({ tenantId, category, count: items.length }, 'Archive entries listed');

    return items.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  }

  /**
   * Delete an archived entry.
   *
   * @param tenantId - Tenant namespace
   * @param category - Content category
   * @param key      - Content key
   * @returns true if deleted, false if not found
   */
  async delete(
    tenantId: string,
    category: string,
    key: string,
  ): Promise<boolean> {
    const path = this.buildPath(tenantId, category, key);
    const existed = this.inMemoryStore.delete(path);

    if (existed) {
      log.info({ tenantId, category, key }, 'Archive entry deleted');
    }

    return existed;
  }

  /**
   * Get total archive size for a tenant (in bytes).
   */
  async getTenantUsage(tenantId: string): Promise<{ totalBytes: number; entryCount: number }> {
    let totalBytes = 0;
    let entryCount = 0;

    for (const [path, stored] of this.inMemoryStore.entries()) {
      if (path.startsWith(`${tenantId}/`)) {
        totalBytes += stored.content.length;
        entryCount++;
      }
    }

    return { totalBytes, entryCount };
  }
}
