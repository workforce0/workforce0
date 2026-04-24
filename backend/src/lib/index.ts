/**
 * =============================================================================
 * LIB MODULE EXPORTS
 * =============================================================================
 *
 * Re-exports all lib modules for convenient importing.
 *
 * @module lib
 */

export { logger, createChildLogger, LogLevel, type LogLevelType } from './logger.js';
export { AppError, Errors, setupErrorHandler } from './error-handler.js';
export { setupDependencies, type Services } from './di-container.js';
export { setupGracefulShutdown } from './graceful-shutdown.js';
export { encrypt, decrypt, generateEncryptionKey, deriveKey } from './encryption.js';
