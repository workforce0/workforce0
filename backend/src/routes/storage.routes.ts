/**
 * =============================================================================
 * LOCAL STORAGE ROUTES
 * =============================================================================
 *
 * Backs the LocalFileStorage driver's "presigned URL" emulation. The
 * driver mints a short-lived JWT; the client uses it as the last path
 * segment when PUTting bytes or GETting the file back. The token carries
 * the storage key, so routes never trust a user-supplied key.
 *
 * Only registers when the active driver is 'local' — deployers on S3
 * never see these endpoints, and no filesystem writes happen from the
 * API process in that mode.
 *
 *   PUT /api/storage/upload/:token   → stream bytes into <root>/<storageKey>
 *   GET /api/storage/download/:token → stream <root>/<storageKey> back
 *
 * Auth: the JWT is the auth. These routes are mounted *outside* the
 * Bearer-auth scope so browsers can PUT directly with `fetch`.
 *
 * @module routes/storage
 */

import fs from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createChildLogger } from '../lib/logger.js';
import { LocalFileStorageService } from '../services/storage/local-file-storage.service.js';

const logger = createChildLogger({ route: 'storage' });

/**
 * Register PUT /upload/:token and GET /download/:token. Caller mounts
 * with prefix '/api/storage' so the public paths match what the local
 * driver minted into its URLs.
 *
 * No-op if the configured storage service isn't the local driver.
 */
export async function registerStorageRoutes(fastify: FastifyInstance): Promise<void> {
  const storage = fastify.services.storageService;

  if (!(storage instanceof LocalFileStorageService)) {
    logger.info('Storage driver is not local — skipping local upload/download routes');
    return;
  }

  const local = storage;

  /**
   * Upload: read the raw request body (any content type), write to disk.
   *
   * We don't register a content-type parser here — instead we consume
   * `request.raw` directly so arbitrary audio/video MIME types flow
   * through without being rejected as "unknown body". Size is capped by
   * the token (`maxSize`) which was in turn capped by
   * MAX_FILE_SIZE_BYTES when the URL was minted.
   */
  fastify.put('/upload/:token', async (request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
    const { token } = request.params;

    let payload;
    try {
      payload = local.verifyUploadToken(token);
    } catch (err) {
      logger.warn('Rejecting upload — bad token', { err: (err as Error).message });
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Upload URL is expired or invalid.' },
      });
    }

    const declaredType = request.headers['content-type'];
    if (declaredType && !declaredType.startsWith(payload.contentType)) {
      logger.warn('Upload content-type mismatch', {
        expected: payload.contentType,
        actual: declaredType,
      });
      return reply.status(400).send({
        success: false,
        error: {
          code: 'CONTENT_TYPE_MISMATCH',
          message: `Expected Content-Type ${payload.contentType}, got ${declaredType}`,
        },
      });
    }

    const chunks: Buffer[] = [];
    let total = 0;

    try {
      for await (const chunk of request.raw) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.byteLength;
        if (total > payload.maxSize) {
          return reply.status(413).send({
            success: false,
            error: {
              code: 'PAYLOAD_TOO_LARGE',
              message: `Upload exceeds declared size ${payload.maxSize} bytes.`,
            },
          });
        }
        chunks.push(buf);
      }
    } catch (err) {
      logger.error('Upload stream failed', { storageKey: payload.storageKey, err: (err as Error).message });
      return reply.status(500).send({
        success: false,
        error: { code: 'UPLOAD_FAILED', message: 'Failed to receive upload.' },
      });
    }

    await local.writeBuffer(payload.storageKey, Buffer.concat(chunks));

    return reply.status(200).send({ success: true, data: { bytesWritten: total } });
  });

  /**
   * Download: verify token, stream the file back. We use a Node read
   * stream piped through Fastify so large files don't have to sit in
   * memory. The storageKey is resolved safely (path traversal rejected).
   */
  fastify.get('/download/:token', async (request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
    const { token } = request.params;

    let payload;
    try {
      payload = local.verifyDownloadToken(token);
    } catch (err) {
      logger.warn('Rejecting download — bad token', { err: (err as Error).message });
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Download URL is expired or invalid.' },
      });
    }

    let abs: string;
    try {
      abs = local.resolveSafe(payload.storageKey);
    } catch {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_STORAGE_KEY', message: 'Invalid storage key in token.' },
      });
    }

    try {
      await fs.promises.access(abs);
    } catch {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Object not found.' },
      });
    }

    reply.header('Content-Type', 'application/octet-stream');
    return reply.send(fs.createReadStream(abs));
  });
}
