/**
 * =============================================================================
 * STORAGE FACTORY
 * =============================================================================
 *
 * Picks the right storage driver for this deployment and hands back the
 * `StorageService` interface. Default is LocalFileStorage — zero cloud
 * dependency, works on a bare VM. Deployers who want S3 flip a single
 * switch by setting `AWS_S3_BUCKET`.
 *
 * Rules:
 *   - AWS_S3_BUCKET set  → S3 driver
 *   - otherwise          → local driver
 *   - STORAGE_DRIVER=s3|local forces the choice and overrides the above
 *
 * @module services/storage
 */

import { createChildLogger } from '../../lib/logger.js';
import { LocalFileStorageService } from './local-file-storage.service.js';
import { S3Service } from './s3.service.js';
import type { StorageService } from './storage.types.js';

const logger = createChildLogger({ service: 'StorageFactory' });

export interface StorageFactoryInput {
  /** Optional explicit override: 's3' | 'local'. */
  driver?: string;
  /** S3 bucket — triggers S3 when no explicit driver is set. */
  awsBucket?: string;
  awsRegion?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  /** Where the local driver writes files (abs or repo-relative). */
  storageRoot: string;
  /** URL the browser reaches the backend on. */
  publicUrl: string;
  /** JWT secret for minting local upload/download tokens. */
  jwtSecret: string;
}

export function createStorageService(input: StorageFactoryInput): StorageService {
  const forced = input.driver?.toLowerCase();
  const useS3 =
    forced === 's3' || (forced !== 'local' && Boolean(input.awsBucket));

  if (useS3) {
    if (!input.awsBucket) {
      throw new Error('STORAGE_DRIVER=s3 but AWS_S3_BUCKET is not set');
    }
    logger.info('Storage driver: s3', { bucket: input.awsBucket });
    return new S3Service({
      bucket: input.awsBucket,
      region: input.awsRegion || 'us-east-1',
      accessKeyId: input.awsAccessKeyId,
      secretAccessKey: input.awsSecretAccessKey,
    });
  }

  logger.info('Storage driver: local', { root: input.storageRoot });
  return new LocalFileStorageService({
    storageRoot: input.storageRoot,
    publicUrl: input.publicUrl,
    jwtSecret: input.jwtSecret,
  });
}

export type { StorageService, PresignedUploadResult } from './storage.types.js';
export { LocalFileStorageService } from './local-file-storage.service.js';
export { S3Service } from './s3.service.js';
