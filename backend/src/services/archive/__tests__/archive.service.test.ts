// mvp/src/services/archive/__tests__/archive.service.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ArchiveService } from '../archive.service.js';

describe('ArchiveService', () => {
  let service: ArchiveService;

  beforeEach(() => {
    // No S3 config — uses in-memory fallback
    service = new ArchiveService();
  });

  // ---- Initialization ----

  it('should initialize in disabled mode without config', () => {
    expect(service.isDisabled()).toBe(true);
  });

  it('should initialize in disabled mode without bucket', () => {
    const s = new ArchiveService({ region: 'us-east-1' });
    expect(s.isDisabled()).toBe(true);
  });

  it('should initialize in enabled mode with bucket config', () => {
    const s = new ArchiveService({ bucket: 'my-bucket', region: 'us-east-1' });
    expect(s.isDisabled()).toBe(false);
  });

  // ---- Archive ----

  it('should archive string content', async () => {
    const result = await service.archive('t1', 'transcript', 'mtg-001', 'Hello world transcript');
    expect(result).not.toBeNull();
    expect(result!.tenantId).toBe('t1');
    expect(result!.category).toBe('transcript');
    expect(result!.key).toBe('mtg-001');
    expect(result!.sizeBytes).toBe('Hello world transcript'.length);
    expect(result!.contentType).toBe('application/json');
  });

  it('should archive object content (auto-serializes to JSON)', async () => {
    const data = { speakers: ['Alice', 'Bob'], segments: [{ text: 'Hello' }] };
    const result = await service.archive('t1', 'transcript', 'mtg-002', data);
    expect(result).not.toBeNull();
    expect(result!.sizeBytes).toBe(JSON.stringify(data).length);
  });

  it('should archive with custom content type and metadata', async () => {
    const result = await service.archive('t1', 'raw_meeting', 'mtg-003', 'raw audio data', {
      contentType: 'audio/wav',
      metadata: { format: 'wav', duration: '3600' },
    });
    expect(result!.contentType).toBe('audio/wav');
    expect(result!.metadata).toEqual({ format: 'wav', duration: '3600' });
  });

  // ---- Retrieve ----

  it('should retrieve archived content', async () => {
    await service.archive('t1', 'transcript', 'mtg-001', 'Test transcript');
    const result = await service.retrieve('t1', 'transcript', 'mtg-001');
    expect(result).not.toBeNull();
    expect(result!.content).toBe('Test transcript');
    expect(result!.key).toBe('mtg-001');
  });

  it('should return null for missing entry', async () => {
    const result = await service.retrieve('t1', 'transcript', 'nonexistent');
    expect(result).toBeNull();
  });

  it('should retrieve with metadata', async () => {
    await service.archive('t1', 'compliance', 'audit-001', '{}', {
      metadata: { auditor: 'system', version: '1' },
    });
    const result = await service.retrieve('t1', 'compliance', 'audit-001');
    expect(result!.metadata).toEqual({ auditor: 'system', version: '1' });
  });

  // ---- List ----

  it('should list all entries for a tenant', async () => {
    await service.archive('t1', 'transcript', 'mtg-001', 'a');
    await service.archive('t1', 'engagement_log', 'eng-001', 'b');
    await service.archive('t2', 'transcript', 'mtg-999', 'c');

    const list = await service.list('t1');
    expect(list).toHaveLength(2);
    expect(list.map((e) => e.key)).toContain('mtg-001');
    expect(list.map((e) => e.key)).toContain('eng-001');
  });

  it('should list entries filtered by category', async () => {
    await service.archive('t1', 'transcript', 'mtg-001', 'a');
    await service.archive('t1', 'engagement_log', 'eng-001', 'b');

    const list = await service.list('t1', 'transcript');
    expect(list).toHaveLength(1);
    expect(list[0].key).toBe('mtg-001');
  });

  it('should return empty list for unknown tenant', async () => {
    const list = await service.list('unknown-tenant');
    expect(list).toEqual([]);
  });

  it('should sort by uploadedAt descending (most recent first)', async () => {
    await service.archive('t1', 'transcript', 'old', 'a');
    // Tiny delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));
    await service.archive('t1', 'transcript', 'new', 'b');

    const list = await service.list('t1');
    expect(list[0].key).toBe('new');
    expect(list[1].key).toBe('old');
  });

  // ---- Delete ----

  it('should delete an archived entry', async () => {
    await service.archive('t1', 'transcript', 'mtg-001', 'to delete');
    const deleted = await service.delete('t1', 'transcript', 'mtg-001');
    expect(deleted).toBe(true);

    const result = await service.retrieve('t1', 'transcript', 'mtg-001');
    expect(result).toBeNull();
  });

  it('should return false when deleting nonexistent entry', async () => {
    const deleted = await service.delete('t1', 'transcript', 'nonexistent');
    expect(deleted).toBe(false);
  });

  // ---- Tenant Usage ----

  it('should calculate tenant storage usage', async () => {
    await service.archive('t1', 'transcript', 'mtg-001', 'short');
    await service.archive('t1', 'engagement_log', 'eng-001', 'medium content');
    await service.archive('t2', 'transcript', 'mtg-999', 'other tenant');

    const usage = await service.getTenantUsage('t1');
    expect(usage.entryCount).toBe(2);
    expect(usage.totalBytes).toBe('short'.length + 'medium content'.length);
  });

  it('should return zero usage for unknown tenant', async () => {
    const usage = await service.getTenantUsage('unknown');
    expect(usage.entryCount).toBe(0);
    expect(usage.totalBytes).toBe(0);
  });

  // ---- Tenant Isolation ----

  it('should isolate archives between tenants', async () => {
    await service.archive('t1', 'transcript', 'shared-key', 'tenant 1 data');
    await service.archive('t2', 'transcript', 'shared-key', 'tenant 2 data');

    const t1Result = await service.retrieve('t1', 'transcript', 'shared-key');
    const t2Result = await service.retrieve('t2', 'transcript', 'shared-key');

    expect(t1Result!.content).toBe('tenant 1 data');
    expect(t2Result!.content).toBe('tenant 2 data');
  });
});
