import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mock functions so they are available inside vi.mock factories
const { mockSend, mockDestroy, mockGetSignedUrl } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockDestroy: vi.fn(),
  mockGetSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/presigned-url'),
}));

vi.mock('@aws-sdk/client-s3', () => {
  class MockS3Client {
    send = mockSend;
    destroy = mockDestroy;
    constructor(_config: unknown) {}
  }
  return {
    S3Client: MockS3Client,
    PutObjectCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
    GetObjectCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
    DeleteObjectCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
    HeadObjectCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

import { S3Service } from '../s3.service.js';

describe('S3Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSignedUrl.mockResolvedValue('https://s3.example.com/presigned-url');
  });

  describe('isEnabled', () => {
    it('returns false when bucket is not configured', () => {
      const service = new S3Service({ bucket: '', region: 'us-east-1' });
      expect(service.isEnabled()).toBe(false);
    });

    it('returns true when bucket is configured', () => {
      const service = new S3Service({ bucket: 'my-bucket', region: 'us-east-1' });
      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('generatePresignedUploadUrl', () => {
    it('generates presigned upload URL with correct storageKey format', async () => {
      const service = new S3Service({ bucket: 'my-bucket', region: 'us-east-1' });
      const now = Date.now();

      const result = await service.generatePresignedUploadUrl(
        'meeting_123',
        'audio/mpeg',
        10_000_000,
      );

      expect(result.uploadUrl).toBe('https://s3.example.com/presigned-url');
      // storageKey format: meetings/{meetingId}/{timestamp}.{ext}
      expect(result.storageKey).toMatch(/^meetings\/meeting_123\/\d+\.mp3$/);
      // Timestamp should be close to now
      const keyTimestamp = parseInt(result.storageKey.split('/')[2].split('.')[0]);
      expect(keyTimestamp).toBeGreaterThanOrEqual(now);
      expect(keyTimestamp).toBeLessThanOrEqual(now + 1000);
    });

    it('uses correct file extension for each MIME type', async () => {
      const service = new S3Service({ bucket: 'my-bucket', region: 'us-east-1' });

      const cases: Array<[string, string]> = [
        ['audio/mpeg', 'mp3'],
        ['audio/mp3', 'mp3'],
        ['audio/wav', 'wav'],
        ['audio/webm', 'webm'],
        ['audio/mp4', 'm4a'],
        ['audio/x-m4a', 'm4a'],
        ['video/mp4', 'mp4'],
        ['video/webm', 'webm'],
      ];

      for (const [mimeType, expectedExt] of cases) {
        const result = await service.generatePresignedUploadUrl(
          'meeting_456',
          mimeType,
          1_000_000,
        );
        expect(result.storageKey).toMatch(new RegExp(`\\.${expectedExt}$`));
      }
    });

    it('calls getSignedUrl with correct expiry (300s)', async () => {
      const service = new S3Service({ bucket: 'my-bucket', region: 'us-east-1' });

      await service.generatePresignedUploadUrl('meeting_123', 'audio/mpeg', 1_000_000);

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 300 },
      );
    });

    it('rejects files over 200MB', async () => {
      const service = new S3Service({ bucket: 'my-bucket', region: 'us-east-1' });
      const tooLarge = 200 * 1024 * 1024 + 1;

      await expect(
        service.generatePresignedUploadUrl('meeting_123', 'audio/mpeg', tooLarge),
      ).rejects.toThrow('exceeds maximum allowed size');
    });

    it('allows files exactly at 200MB', async () => {
      const service = new S3Service({ bucket: 'my-bucket', region: 'us-east-1' });
      const exactly200MB = 200 * 1024 * 1024;

      const result = await service.generatePresignedUploadUrl(
        'meeting_123',
        'audio/mpeg',
        exactly200MB,
      );
      expect(result.uploadUrl).toBeDefined();
    });

    it('rejects unsupported MIME types', async () => {
      const service = new S3Service({ bucket: 'my-bucket', region: 'us-east-1' });

      await expect(
        service.generatePresignedUploadUrl('meeting_123', 'application/pdf', 1_000_000),
      ).rejects.toThrow('Unsupported MIME type');

      await expect(
        service.generatePresignedUploadUrl('meeting_123', 'text/plain', 1_000_000),
      ).rejects.toThrow('Unsupported MIME type');
    });

    it('throws when service is disabled', async () => {
      const service = new S3Service({ bucket: '', region: 'us-east-1' });

      await expect(
        service.generatePresignedUploadUrl('meeting_123', 'audio/mpeg', 1_000_000),
      ).rejects.toThrow('S3Service is not enabled');
    });
  });

  describe('generatePresignedDownloadUrl', () => {
    it('generates a presigned download URL', async () => {
      const service = new S3Service({ bucket: 'my-bucket', region: 'us-east-1' });

      const url = await service.generatePresignedDownloadUrl('meetings/meeting_123/12345.mp3');

      expect(url).toBe('https://s3.example.com/presigned-url');
    });

    it('calls getSignedUrl with 1 hour expiry (3600s)', async () => {
      const service = new S3Service({ bucket: 'my-bucket', region: 'us-east-1' });

      await service.generatePresignedDownloadUrl('meetings/meeting_123/12345.mp3');

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 3600 },
      );
    });

    it('throws when service is disabled', async () => {
      const service = new S3Service({ bucket: '', region: 'us-east-1' });

      await expect(
        service.generatePresignedDownloadUrl('meetings/meeting_123/12345.mp3'),
      ).rejects.toThrow('S3Service is not enabled');
    });
  });

  describe('deleteObject', () => {
    it('sends DeleteObjectCommand', async () => {
      const service = new S3Service({ bucket: 'my-bucket', region: 'us-east-1' });
      mockSend.mockResolvedValue({});

      await service.deleteObject('meetings/meeting_123/12345.mp3');

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('throws when service is disabled', async () => {
      const service = new S3Service({ bucket: '', region: 'us-east-1' });

      await expect(
        service.deleteObject('meetings/meeting_123/12345.mp3'),
      ).rejects.toThrow('S3Service is not enabled');
    });
  });

  describe('objectExists', () => {
    it('returns true when object exists', async () => {
      const service = new S3Service({ bucket: 'my-bucket', region: 'us-east-1' });
      mockSend.mockResolvedValue({});

      const exists = await service.objectExists('meetings/meeting_123/12345.mp3');

      expect(exists).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('returns false when object does not exist (NotFound)', async () => {
      const service = new S3Service({ bucket: 'my-bucket', region: 'us-east-1' });
      const notFoundError = new Error('Not Found');
      notFoundError.name = 'NotFound';
      mockSend.mockRejectedValue(notFoundError);

      const exists = await service.objectExists('meetings/nonexistent/12345.mp3');

      expect(exists).toBe(false);
    });

    it('returns false when object does not exist (NoSuchKey)', async () => {
      const service = new S3Service({ bucket: 'my-bucket', region: 'us-east-1' });
      const noSuchKeyError = new Error('No Such Key');
      noSuchKeyError.name = 'NoSuchKey';
      mockSend.mockRejectedValue(noSuchKeyError);

      const exists = await service.objectExists('meetings/nonexistent/12345.mp3');

      expect(exists).toBe(false);
    });

    it('rethrows other errors', async () => {
      const service = new S3Service({ bucket: 'my-bucket', region: 'us-east-1' });
      mockSend.mockRejectedValue(new Error('Access Denied'));

      await expect(
        service.objectExists('meetings/meeting_123/12345.mp3'),
      ).rejects.toThrow('Access Denied');
    });

    it('throws when service is disabled', async () => {
      const service = new S3Service({ bucket: '', region: 'us-east-1' });

      await expect(
        service.objectExists('meetings/meeting_123/12345.mp3'),
      ).rejects.toThrow('S3Service is not enabled');
    });
  });

  describe('shutdown', () => {
    it('destroys the S3 client', () => {
      const service = new S3Service({ bucket: 'my-bucket', region: 'us-east-1' });

      service.shutdown();

      expect(mockDestroy).toHaveBeenCalledTimes(1);
    });

    it('does nothing when service is disabled', () => {
      const service = new S3Service({ bucket: '', region: 'us-east-1' });

      // Should not throw
      service.shutdown();

      expect(mockDestroy).not.toHaveBeenCalled();
    });
  });
});
