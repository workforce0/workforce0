import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

import { LocalFileStorageService } from '../local-file-storage.service.js';

const JWT_SECRET = 'test-secret-for-local-storage-tests-123456';

async function makeTmpRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'wf0-local-storage-'));
}

describe('LocalFileStorageService', () => {
  let root: string;
  let service: LocalFileStorageService;

  beforeEach(async () => {
    root = await makeTmpRoot();
    service = new LocalFileStorageService({
      storageRoot: root,
      publicUrl: 'http://localhost:3000',
      jwtSecret: JWT_SECRET,
    });
    // the service does mkdir async in constructor; give it a tick
    await new Promise((r) => setImmediate(r));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('isEnabled', () => {
    it('is true when root + secret provided', () => {
      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('generatePresignedUploadUrl', () => {
    it('returns a token-bearing URL and a meetings/<id>/<ts>.<ext> key', async () => {
      const { uploadUrl, storageKey } = await service.generatePresignedUploadUrl(
        'meeting_abc',
        'audio/mpeg',
        5_000_000,
      );

      expect(uploadUrl).toMatch(/^http:\/\/localhost:3000\/api\/storage\/upload\/.+$/);
      expect(storageKey).toMatch(/^meetings\/meeting_abc\/\d+\.mp3$/);
    });

    it('rejects unsupported MIME types', async () => {
      await expect(
        service.generatePresignedUploadUrl('meeting_x', 'application/pdf', 1000),
      ).rejects.toThrow(/Unsupported MIME type/);
    });

    it('rejects files over 200 MB', async () => {
      await expect(
        service.generatePresignedUploadUrl('meeting_x', 'audio/mpeg', 300 * 1024 * 1024),
      ).rejects.toThrow(/exceeds maximum/);
    });

    it('mints a token that round-trips through verifyUploadToken', async () => {
      const { uploadUrl } = await service.generatePresignedUploadUrl(
        'meeting_abc',
        'audio/mpeg',
        5_000_000,
      );
      const token = uploadUrl.split('/').pop()!;
      const payload = service.verifyUploadToken(token);
      expect(payload.kind).toBe('upload');
      expect(payload.storageKey).toMatch(/^meetings\/meeting_abc\//);
      expect(payload.maxSize).toBe(5_000_000);
      expect(payload.contentType).toBe('audio/mpeg');
    });
  });

  describe('generatePresignedDownloadUrl', () => {
    it('mints a download token bound to the requested storage key', async () => {
      const url = await service.generatePresignedDownloadUrl('meetings/m1/1.mp3');
      const token = url.split('/').pop()!;
      const payload = service.verifyDownloadToken(token);
      expect(payload.kind).toBe('download');
      expect(payload.storageKey).toBe('meetings/m1/1.mp3');
    });
  });

  describe('token kind guards', () => {
    it('rejects an upload token passed to verifyDownloadToken', async () => {
      const { uploadUrl } = await service.generatePresignedUploadUrl(
        'meeting_x', 'audio/mpeg', 1000,
      );
      const token = uploadUrl.split('/').pop()!;
      expect(() => service.verifyDownloadToken(token)).toThrow(/Wrong token kind/);
    });

    it('rejects a download token passed to verifyUploadToken', async () => {
      const url = await service.generatePresignedDownloadUrl('meetings/m1/1.mp3');
      const token = url.split('/').pop()!;
      expect(() => service.verifyUploadToken(token)).toThrow(/Wrong token kind/);
    });
  });

  describe('writeBuffer / readBuffer / objectExists / deleteObject', () => {
    it('writes a file, reads it back, confirms existence, then deletes', async () => {
      const key = 'meetings/m1/123.mp3';
      const payload = Buffer.from('hello world');

      await service.writeBuffer(key, payload);
      expect(await service.objectExists(key)).toBe(true);

      const read = await service.readBuffer(key);
      expect(read.equals(payload)).toBe(true);

      await service.deleteObject(key);
      expect(await service.objectExists(key)).toBe(false);
    });

    it('deleteObject is a no-op when the file is missing', async () => {
      await expect(service.deleteObject('meetings/never/here.mp3')).resolves.toBeUndefined();
    });

    it('objectExists returns false for a missing file without throwing', async () => {
      expect(await service.objectExists('meetings/nope/nope.mp3')).toBe(false);
    });
  });

  describe('resolveSafe', () => {
    it('rejects relative parent traversal', () => {
      expect(() => service.resolveSafe('../etc/passwd')).toThrow(/outside storage root/);
    });

    it('rejects absolute paths that escape root', () => {
      expect(() => service.resolveSafe('/etc/passwd')).toThrow(/outside storage root/);
    });

    it('accepts a key under the root', () => {
      const abs = service.resolveSafe('meetings/m1/1.mp3');
      expect(abs.startsWith(path.resolve(root))).toBe(true);
    });
  });
});
