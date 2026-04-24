/**
 * =============================================================================
 * STORAGE INTERFACE
 * =============================================================================
 *
 * Workforce0 stores meeting audio so the transcription worker can pick it
 * up async. Two drivers implement this surface:
 *
 *   1. LocalFileStorage (default) — writes to a mounted disk. Zero cloud
 *      dependency. Works out of the box for every self-host.
 *   2. S3StorageDriver (opt-in)   — keeps the old behaviour for deployers
 *      who want cloud redundancy. Enabled by setting AWS_S3_BUCKET.
 *
 * The storage key is always a path-like string (e.g.
 * "meetings/abc123/1712345678.mp3"). The upload URL is a full URL the
 * client can PUT to without extra auth — locally it's a backend-hosted
 * route signed with JWT_SECRET, on S3 it's a presigned PUT URL.
 *
 * @module services/storage/types
 */

/** Handful of audio/video MIME types we accept. Shared across drivers. */
export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/webm',
  'audio/mp4',
  'audio/x-m4a',
  'video/mp4',
  'video/webm',
]);

/** Map MIME to a clean extension — used when we mint keys. */
export const MIME_TO_EXTENSION: Readonly<Record<string, string>> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/** 200 MB cap shared across drivers so both reject the same way. */
export const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;

/** Presigned URL expiries. */
export const UPLOAD_URL_EXPIRY_SECONDS = 300;     // 5 min
export const DOWNLOAD_URL_EXPIRY_SECONDS = 3600;  // 1 hour

export interface PresignedUploadResult {
  /** Full URL the client PUTs bytes to. */
  uploadUrl: string;
  /** Opaque key we store on Meeting.audioUrl and use for later operations. */
  storageKey: string;
}

/**
 * The storage abstraction every driver implements. Keep it small — any
 * method we add here means both drivers must stay in sync.
 */
export interface StorageService {
  /** Driver identifier used in logs and /health. */
  readonly driver: 'local' | 's3';

  /** False when the driver can't operate (missing S3 creds, missing dir, etc.). */
  isEnabled(): boolean;

  /** Produce an upload URL the client can PUT to within UPLOAD_URL_EXPIRY_SECONDS. */
  generatePresignedUploadUrl(
    meetingId: string,
    contentType: string,
    contentLength: number,
  ): Promise<PresignedUploadResult>;

  /** URL the browser can GET within DOWNLOAD_URL_EXPIRY_SECONDS to stream the file. */
  generatePresignedDownloadUrl(storageKey: string): Promise<string>;

  /** Delete a stored object. No-op if it already doesn't exist. */
  deleteObject(storageKey: string): Promise<void>;

  /** True if the object is readable right now. */
  objectExists(storageKey: string): Promise<boolean>;

  /** Release any long-lived client handles on process shutdown. */
  shutdown(): void;
}

/**
 * Build a clean storage key shared by both drivers:
 *   meetings/<meetingId>/<timestamp>.<ext>
 *
 * We namespace by meetingId so lifecycle rules (or a cron) can reap a
 * whole meeting's artefacts with one prefix delete.
 */
export function buildStorageKey(meetingId: string, contentType: string): string {
  const ext = MIME_TO_EXTENSION[contentType] ?? 'bin';
  return `meetings/${meetingId}/${Date.now()}.${ext}`;
}
