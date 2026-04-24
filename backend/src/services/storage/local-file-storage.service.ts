/**
 * =============================================================================
 * LOCAL FILE STORAGE — default driver
 * =============================================================================
 *
 * Stores meeting audio on a mounted disk. Zero cloud dependency, works
 * out of the box for every self-host. The presigned-URL concept is
 * emulated with a short-lived JWT that carries the storage key; the
 * backend exposes two routes the token grants access to:
 *
 *   PUT /api/storage/upload/:token   — client streams bytes here
 *   GET /api/storage/download/:token — returns the file stream
 *
 * Tokens are signed with JWT_SECRET (same one used for auth). They carry
 * the storage key, upper size cap, content type, expiry, and a usage
 * kind ('upload' | 'download') so an upload token can't download and
 * vice versa.
 *
 * Layout on disk:
 *   <STORAGE_ROOT>/<storageKey>
 *   where storageKey is "meetings/<meetingId>/<timestamp>.<ext>"
 *
 * Reaping: not this driver's job. Teams that want retention windows add
 * a cron that runs `find <STORAGE_ROOT>/meetings -mtime +N -delete`.
 *
 * @module services/storage/local-file-storage
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ALLOWED_MIME_TYPES,
  DOWNLOAD_URL_EXPIRY_SECONDS,
  MAX_FILE_SIZE_BYTES,
  UPLOAD_URL_EXPIRY_SECONDS,
  buildStorageKey,
  type PresignedUploadResult,
  type StorageService,
} from './storage.types.js';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'LocalFileStorage' });

export interface LocalFileStorageConfig {
  /** Absolute or repo-relative root where files land. Created on boot. */
  storageRoot: string;
  /** Public base URL the client talks to (e.g. http://localhost:3000). */
  publicUrl: string;
  /** JWT secret for minting + verifying token-gated URLs. */
  jwtSecret: string;
}

export interface LocalUploadToken {
  kind: 'upload';
  storageKey: string;
  contentType: string;
  maxSize: number;
  exp: number;
}

export interface LocalDownloadToken {
  kind: 'download';
  storageKey: string;
  exp: number;
}

export class LocalFileStorageService implements StorageService {
  public readonly driver = 'local' as const;
  private readonly root: string;
  private readonly publicUrl: string;
  private readonly jwtSecret: string;

  constructor(config: LocalFileStorageConfig) {
    this.root = path.resolve(config.storageRoot);
    this.publicUrl = config.publicUrl.replace(/\/$/, '');
    this.jwtSecret = config.jwtSecret;

    void fs.mkdir(this.root, { recursive: true }).then(
      () => logger.info('LocalFileStorage initialised', { root: this.root }),
      (err) =>
        logger.error('LocalFileStorage could not create root — uploads will fail', {
          root: this.root,
          err: (err as Error).message,
        }),
    );
  }

  isEnabled(): boolean {
    return Boolean(this.root && this.jwtSecret);
  }

  async generatePresignedUploadUrl(
    meetingId: string,
    contentType: string,
    contentLength: number,
  ): Promise<PresignedUploadResult> {
    if (!ALLOWED_MIME_TYPES.has(contentType)) {
      throw new Error(
        `Unsupported MIME type: ${contentType}. Allowed: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
      );
    }
    if (contentLength > MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `File size ${contentLength} exceeds maximum ${MAX_FILE_SIZE_BYTES} bytes (200 MB)`,
      );
    }

    const storageKey = buildStorageKey(meetingId, contentType);
    const token = this.mintUploadToken(storageKey, contentType, contentLength);
    const uploadUrl = `${this.publicUrl}/api/storage/upload/${token}`;

    logger.info('Local upload URL minted', { meetingId, storageKey });
    return { uploadUrl, storageKey };
  }

  async generatePresignedDownloadUrl(storageKey: string): Promise<string> {
    const token = this.mintDownloadToken(storageKey);
    return `${this.publicUrl}/api/storage/download/${token}`;
  }

  async deleteObject(storageKey: string): Promise<void> {
    const abs = this.resolveSafe(storageKey);
    try {
      await fs.unlink(abs);
      logger.info('Deleted local file', { storageKey });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      throw err;
    }
  }

  async objectExists(storageKey: string): Promise<boolean> {
    try {
      const abs = this.resolveSafe(storageKey);
      await fs.access(abs);
      return true;
    } catch {
      return false;
    }
  }

  shutdown(): void {
    // No long-lived handles to close.
  }

  // --- token helpers ------------------------------------------------------
  //
  // We mint/verify HS256 JWTs by hand (same pattern as auth.routes.ts) so
  // we don't pull in the `jsonwebtoken` package just for two methods. The
  // token layout is the standard `<header>.<body>.<signature>` triple with
  // base64url encoding. `body.exp` is seconds-since-epoch. Separate `kind`
  // claims ensure an upload token can't be used as a download token.

  mintUploadToken(storageKey: string, contentType: string, maxSize: number): string {
    return this.signToken({
      kind: 'upload',
      storageKey,
      contentType,
      maxSize,
      exp: Math.floor(Date.now() / 1000) + UPLOAD_URL_EXPIRY_SECONDS,
    });
  }

  mintDownloadToken(storageKey: string): string {
    return this.signToken({
      kind: 'download',
      storageKey,
      exp: Math.floor(Date.now() / 1000) + DOWNLOAD_URL_EXPIRY_SECONDS,
    });
  }

  /**
   * Verify a token minted by this service and return the payload. Throws
   * on invalid/expired tokens so callers can 401. Exposed so routes can
   * gate access without re-importing the signing secret.
   */
  verifyUploadToken(token: string): LocalUploadToken {
    const payload = this.verifyToken<LocalUploadToken>(token);
    if (payload.kind !== 'upload') throw new Error('Wrong token kind');
    return payload;
  }

  verifyDownloadToken(token: string): LocalDownloadToken {
    const payload = this.verifyToken<LocalDownloadToken>(token);
    if (payload.kind !== 'download') throw new Error('Wrong token kind');
    return payload;
  }

  private signToken(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.jwtSecret)
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  private verifyToken<T extends { exp: number }>(token: string): T {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Malformed token');
    const [header, body, signature] = parts;
    const expected = crypto
      .createHmac('sha256', this.jwtSecret)
      .update(`${header}.${body}`)
      .digest('base64url');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      throw new Error('Bad signature');
    }
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as T;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error('Token expired');
    }
    return payload;
  }

  // --- filesystem helpers -------------------------------------------------

  /** Resolve storageKey under root and refuse anything that tries to escape. */
  resolveSafe(storageKey: string): string {
    const abs = path.resolve(this.root, storageKey);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (abs !== this.root && !abs.startsWith(rootWithSep)) {
      throw new Error(`Refusing path outside storage root: ${storageKey}`);
    }
    return abs;
  }

  /** Stream-friendly write helper used by the PUT route. */
  async writeBuffer(storageKey: string, buf: Buffer): Promise<void> {
    const abs = this.resolveSafe(storageKey);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, buf);
    logger.info('Wrote local file', { storageKey, bytes: buf.byteLength });
  }

  /** Read-friendly handle for the GET route. */
  async readBuffer(storageKey: string): Promise<Buffer> {
    const abs = this.resolveSafe(storageKey);
    return fs.readFile(abs);
  }
}
