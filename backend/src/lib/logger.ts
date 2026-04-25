/**
 * =============================================================================
 * LOGGER CONFIGURATION
 * =============================================================================
 *
 * Centralized logging configuration using Pino.
 *
 * Why Pino?
 * ---------
 * - Extremely fast (10x faster than alternatives)
 * - JSON output for production (easy to parse in log aggregators)
 * - Pretty print for development
 * - Built-in support for Fastify
 *
 * Log Levels (in order of severity):
 * ----------------------------------
 * - fatal: Application cannot continue
 * - error: Error occurred but application continues
 * - warn:  Something unexpected but not an error
 * - info:  Normal operation events
 * - debug: Detailed debugging information
 * - trace: Very detailed tracing (rarely used)
 *
 * Usage:
 * ------
 * ```typescript
 * import { logger } from './lib/logger';
 *
 * logger.info('User created', { userId: '123' });
 * logger.error('Failed to process', { error: err, taskId: 'task_123' });
 * ```
 *
 * @module lib/logger
 */

import pino from 'pino';
import { config } from '../config/index.js';

/**
 * Flexible log function that accepts both patterns used in this codebase:
 *   logger.info('message', { data })   — message-first (codebase convention)
 *   logger.info({ data }, 'message')   — object-first (pino native)
 *   logger.info('message')             — message-only
 */
type FlexibleLogFn = {
  (msg: string, ...args: unknown[]): void;
  (obj: object, msg?: string, ...args: unknown[]): void;
};

export interface Logger {
  fatal: FlexibleLogFn;
  error: FlexibleLogFn;
  warn: FlexibleLogFn;
  info: FlexibleLogFn;
  debug: FlexibleLogFn;
  trace: FlexibleLogFn;
  child(bindings: Record<string, unknown>): Logger;
  level: string;
}

/**
 * Create the logger instance with environment-appropriate configuration.
 *
 * Production: JSON format for log aggregation (CloudWatch, Datadog, etc.)
 * Development: Pretty print with colors for readability
 */
export const logger: Logger = pino({
  // Set log level based on environment
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',

  // Base fields included in every log entry
  base: {
    service: 'workforce0',
    version: '0.1.0',
    env: config.NODE_ENV,
  },

  // Timestamp format
  timestamp: pino.stdTimeFunctions.isoTime,

  // Pretty print in development
  transport: config.NODE_ENV !== 'production'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,

  // Redact sensitive fields from logs.
  // We list both common names and nested req.body.* paths so that even an
  // accidental `logger.info({ body })` won't leak BYOK secrets.
  redact: {
    paths: [
      'password',
      'token',
      'apiKey',
      'authorization',
      'envHints',
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.token',
      'req.body.apiKey',
    ],
    remove: true,
  },
});

/**
 * Create a child logger with additional context.
 *
 * Use this to add context that should be included in all logs
 * for a specific operation or request.
 *
 * @param context - Additional fields to include in all logs
 * @returns Child logger instance
 *
 * @example
 * ```typescript
 * const taskLogger = createChildLogger({
 *   taskId: 'task_123',
 *   agentType: 'ba_agent',
 *   tenantId: 'tenant_456'
 * });
 *
 * taskLogger.info('Processing started');
 * taskLogger.info('Step 1 complete');
 * // All logs will include taskId, agentType, tenantId
 * ```
 */
export function createChildLogger(context: Record<string, unknown>): Logger {
  return logger.child(context);
}

/**
 * Log levels enum for type-safe level checking.
 */
export const LogLevel = {
  FATAL: 'fatal',
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
  TRACE: 'trace',
} as const;

export type LogLevelType = typeof LogLevel[keyof typeof LogLevel];
