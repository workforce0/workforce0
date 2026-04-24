/**
 * =============================================================================
 * S3 SERVICE
 * =============================================================================
 *
 * Manages audio/video file storage in Amazon S3 for meeting ingestion.
 *
 * Responsibilities:
 * -----------------
 * - Generate presigned upload URLs for client-side direct uploads
 * - Generate presigned download URLs for audio playback
 * - Delete and check existence of S3 objects
 *
 * Usage:
 * ------
 * ```typescript
 * const s3Service = new S3Service({
 *   bucket: 'my-bucket',
 *   region: 'us-east-1',
 * });
 *
 * const { uploadUrl, storageKey } = await s3Service.generatePresignedUploadUrl(
 *   'meeting_123',
 *   'audio/mpeg',
 *   50_000_000
 * );
 * ```
 *
 * The service gracefully disables when no bucket is configured (returns
 * `isEnabled() === false`). This allows the platform to run without S3
 * in development or when the feature is not needed.
 *
 * @module services/storage/s3
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createChildLogger } from '../../lib/logger.js';
import type { PresignedUploadResult, StorageService } from './storage.types.js';

const logger = createChildLogger({ service: 'S3Service' });

/**
 * Maximum allowed file size for uploads (200 MB).
 */
const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;

/**
 * Presigned upload URL expiry in seconds (5 minutes).
 */
const UPLOAD_URL_EXPIRY_SECONDS = 300;

/**
 * Presigned download URL expiry in seconds (1 hour).
 */
const DOWNLOAD_URL_EXPIRY_SECONDS = 3600;

/**
 * Allowed MIME types for meeting audio/video uploads.
 */
const ALLOWED_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/webm',
  'audio/mp4',
  'audio/x-m4a',
  'video/mp4',
  'video/webm',
]);

/**
 * Map of MIME type to file extension.
 */
const MIME_TO_EXTENSION: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/**
 * Configuration options for the S3 service.
 */
export interface S3ServiceConfig {
  bucket: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

// PresignedUploadResult moved to storage.types.ts so every driver shares the shape.

/**
 * S3 Service - manages presigned URL generation and audio file storage.
 *
 * @example
 * ```typescript
 * const s3 = new S3Service({ bucket: 'workforce0-audio', region: 'us-east-1' });
 *
 * if (s3.isEnabled()) {
 *   const { uploadUrl, storageKey } = await s3.generatePresignedUploadUrl(
 *     'meeting_abc',
 *     'audio/mpeg',
 *     10_000_000,
 *   );
 * }
 * ```
 */
export class S3Service implements StorageService {
  public readonly driver = 's3' as const;
  private readonly client: S3Client | null;
  private readonly bucket: string;

  constructor(config: S3ServiceConfig) {
    this.bucket = config.bucket;

    if (!config.bucket) {
      logger.warn('S3 bucket not configured - S3Service disabled');
      this.client = null;
      return;
    }

    const clientConfig: Record<string, unknown> = {
      region: config.region,
    };

    if (config.accessKeyId && config.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }

    this.client = new S3Client(clientConfig);
    logger.info('S3Service initialized', { bucket: config.bucket, region: config.region });
  }

  /**
   * Check whether the S3 service is enabled (bucket configured).
   */
  isEnabled(): boolean {
    return this.client !== null;
  }

  /**
   * Generate a presigned PUT URL for direct client-side upload.
   *
   * @param meetingId - Meeting ID to namespace the upload
   * @param contentType - MIME type of the file being uploaded
   * @param contentLength - Size of the file in bytes
   * @returns Presigned upload URL and the S3 key where the file will be stored
   * @throws Error if service is disabled, MIME type is unsupported, or file is too large
   */
  async generatePresignedUploadUrl(
    meetingId: string,
    contentType: string,
    contentLength: number,
  ): Promise<PresignedUploadResult> {
    this.ensureEnabled();

    if (!ALLOWED_MIME_TYPES.has(contentType)) {
      throw new Error(
        `Unsupported MIME type: ${contentType}. Allowed: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
      );
    }

    if (contentLength > MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `File size ${contentLength} bytes exceeds maximum allowed size of ${MAX_FILE_SIZE_BYTES} bytes (200MB)`,
      );
    }

    const ext = MIME_TO_EXTENSION[contentType] || 'bin';
    const timestamp = Date.now();
    const storageKey = `meetings/${meetingId}/${timestamp}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      ContentType: contentType,
      ContentLength: contentLength,
    });

    const uploadUrl = await getSignedUrl(this.client!, command, {
      expiresIn: UPLOAD_URL_EXPIRY_SECONDS,
    });

    logger.info('Generated presigned upload URL', {
      meetingId,
      storageKey,
      contentType,
      contentLength,
    });

    return { uploadUrl, storageKey };
  }

  /**
   * Generate a presigned GET URL for downloading/streaming an audio file.
   *
   * @param storageKey - S3 object key
   * @returns Presigned download URL (1 hour expiry)
   * @throws Error if service is disabled
   */
  async generatePresignedDownloadUrl(storageKey: string): Promise<string> {
    this.ensureEnabled();

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });

    const downloadUrl = await getSignedUrl(this.client!, command, {
      expiresIn: DOWNLOAD_URL_EXPIRY_SECONDS,
    });

    logger.debug('Generated presigned download URL', { storageKey });

    return downloadUrl;
  }

  /**
   * Delete an object from S3.
   *
   * @param storageKey - S3 object key to delete
   * @throws Error if service is disabled
   */
  async deleteObject(storageKey: string): Promise<void> {
    this.ensureEnabled();

    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });

    await this.client!.send(command);

    logger.info('Deleted S3 object', { storageKey });
  }

  /**
   * Check whether an object exists in S3.
   *
   * @param storageKey - S3 object key to check
   * @returns true if the object exists, false otherwise
   * @throws Error if service is disabled
   */
  async objectExists(storageKey: string): Promise<boolean> {
    this.ensureEnabled();

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
      });

      await this.client!.send(command);
      return true;
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === 'NotFound' || err.name === 'NoSuchKey') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Destroy the S3 client and release resources.
   */
  shutdown(): void {
    if (this.client) {
      this.client.destroy();
      logger.info('S3Service shut down');
    }
  }

  /**
   * Ensure the service is enabled before performing operations.
   */
  private ensureEnabled(): void {
    if (!this.client) {
      throw new Error('S3Service is not enabled - bucket not configured');
    }
  }
}
