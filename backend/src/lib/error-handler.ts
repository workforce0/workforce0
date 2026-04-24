/**
 * =============================================================================
 * GLOBAL ERROR HANDLER
 * =============================================================================
 *
 * Centralized error handling for the entire application.
 *
 * Error Handling Strategy:
 * ------------------------
 * 1. All errors are caught by this handler
 * 2. Errors are categorized (operational vs programmer)
 * 3. Appropriate HTTP status codes are returned
 * 4. Errors are logged with context for debugging
 * 5. Sensitive information is never exposed to clients
 *
 * Error Categories:
 * -----------------
 * - Operational Errors: Expected errors (validation, not found, etc.)
 *   → Return appropriate status code, log as warning
 *
 * - Programmer Errors: Bugs in code (null reference, etc.)
 *   → Return 500, log as error, alert in production
 *
 * @module lib/error-handler
 */

import { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { logger } from './logger.js';
import { config } from '../config/index.js';

/**
 * Custom application error class.
 *
 * Use this class when throwing errors that should be returned to clients
 * with specific status codes and messages.
 *
 * @example
 * ```typescript
 * // Not found error
 * throw new AppError('Meeting not found', 404, 'MEETING_NOT_FOUND');
 *
 * // Validation error
 * throw new AppError('Invalid input', 400, 'VALIDATION_ERROR', {
 *   field: 'email',
 *   message: 'Must be a valid email'
 * });
 *
 * // Unauthorized
 * throw new AppError('Invalid token', 401, 'UNAUTHORIZED');
 * ```
 */
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = 'INTERNAL_ERROR',
    public details?: Record<string, unknown>,
    public isOperational: boolean = true
  ) {
    super(message);
    this.name = 'AppError';

    // Capture stack trace (excluding constructor call)
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Pre-defined error factories for common error types.
 *
 * Using factories ensures consistent error formatting across the codebase.
 */
export const Errors = {
  /**
   * Resource not found (404)
   */
  notFound: (resource: string, id?: string) =>
    new AppError(
      `${resource}${id ? ` with id ${id}` : ''} not found`,
      404,
      `${resource.toUpperCase()}_NOT_FOUND`
    ),

  /**
   * Validation error (400)
   */
  validation: (message: string, details?: Record<string, unknown>) =>
    new AppError(message, 400, 'VALIDATION_ERROR', details),

  /**
   * Unauthorized (401)
   */
  unauthorized: (message = 'Unauthorized') =>
    new AppError(message, 401, 'UNAUTHORIZED'),

  /**
   * Forbidden (403)
   */
  forbidden: (message = 'Forbidden') =>
    new AppError(message, 403, 'FORBIDDEN'),

  /**
   * Conflict (409)
   */
  conflict: (message: string) =>
    new AppError(message, 409, 'CONFLICT'),

  /**
   * Rate limited (429)
   */
  rateLimited: (retryAfter?: number) =>
    new AppError('Too many requests', 429, 'RATE_LIMITED', { retryAfter }),

  /**
   * External service error (502)
   */
  externalService: (service: string, message: string) =>
    new AppError(
      `External service error: ${service}`,
      502,
      'EXTERNAL_SERVICE_ERROR',
      { service, originalMessage: message }
    ),

  /**
   * Internal error (500)
   */
  internal: (message = 'Internal server error') =>
    new AppError(message, 500, 'INTERNAL_ERROR', undefined, false),
};

/**
 * Sets up the global error handler on the Fastify instance.
 *
 * This handler catches all unhandled errors and formats them consistently.
 *
 * @param app - Fastify instance
 */
export function setupErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (error: FastifyError | AppError | ZodError | Error, request: FastifyRequest, reply: FastifyReply) => {
      // Create request context for logging
      const requestContext = {
        requestId: request.id,
        method: request.method,
        url: request.url,
        tenantId: (request.headers['x-tenant-id'] as string) || 'unknown',
      };

      // =======================================================================
      // Handle Zod validation errors
      // =======================================================================
      if (error instanceof ZodError) {
        const formattedErrors = error.errors.map((err) => ({
          path: err.path.join('.'),
          message: err.message,
        }));

        logger.warn('Validation error', {
          ...requestContext,
          errors: formattedErrors,
        });

        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: { errors: formattedErrors },
          },
        });
      }

      // =======================================================================
      // Handle AppError (our custom errors)
      // =======================================================================
      if (error instanceof AppError) {
        const logLevel = error.isOperational ? 'warn' : 'error';

        logger[logLevel]('Application error', {
          ...requestContext,
          errorCode: error.code,
          statusCode: error.statusCode,
          message: error.message,
          details: error.details,
          stack: error.isOperational ? undefined : error.stack,
        });

        return reply.status(error.statusCode).send({
          success: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        });
      }

      // =======================================================================
      // Handle Fastify errors (e.g., validation schema errors)
      // =======================================================================
      if ('statusCode' in error && error.statusCode && error.statusCode < 500) {
        logger.warn('Fastify error', {
          ...requestContext,
          statusCode: error.statusCode,
          message: error.message,
        });

        return reply.status(error.statusCode).send({
          success: false,
          error: {
            code: 'REQUEST_ERROR',
            message: error.message,
          },
        });
      }

      // =======================================================================
      // Handle unknown errors (programmer errors / bugs)
      // =======================================================================
      logger.error('Unhandled error', {
        ...requestContext,
        error: error.message,
        stack: error.stack,
        name: error.name,
      });

      // In production, don't expose error details
      const isProduction = config.NODE_ENV === 'production';

      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: isProduction
            ? 'An unexpected error occurred'
            : error.message,
          ...(isProduction ? {} : { stack: error.stack }),
        },
      });
    }
  );

  // ==========================================================================
  // Handle 404 Not Found for undefined routes
  // ==========================================================================
  app.setNotFoundHandler((request, reply) => {
    logger.debug('Route not found', {
      method: request.method,
      url: request.url,
    });

    return reply.status(404).send({
      success: false,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found`,
      },
    });
  });

  logger.debug('Global error handler configured');
}
