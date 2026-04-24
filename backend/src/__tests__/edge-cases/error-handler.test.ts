/**
 * =============================================================================
 * ERROR HANDLER — Edge Case & Error Handling Tests
 * =============================================================================
 *
 * Tests the AppError class and Errors factory:
 *   - AppError has correct status, code, message, details
 *   - AppError defaults (500, INTERNAL_ERROR, isOperational=true)
 *   - Error serialization structure for API responses
 *   - Errors factory functions (notFound, validation, unauthorized, etc.)
 *   - Stack trace capture
 *   - isOperational flag behavior
 */

import { describe, it, expect } from 'vitest';
import { AppError, Errors } from '../../lib/error-handler.js';

describe('AppError', () => {
  // =========================================================================
  // Constructor
  // =========================================================================
  describe('constructor', () => {
    it('creates an error with all properties', () => {
      const err = new AppError('Something broke', 422, 'VALIDATION_FAILED', {
        field: 'email',
      });

      expect(err.message).toBe('Something broke');
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe('VALIDATION_FAILED');
      expect(err.details).toEqual({ field: 'email' });
      expect(err.isOperational).toBe(true);
    });

    it('uses correct defaults when minimal args provided', () => {
      const err = new AppError('Minimal error');

      expect(err.message).toBe('Minimal error');
      expect(err.statusCode).toBe(500);
      expect(err.code).toBe('INTERNAL_ERROR');
      expect(err.details).toBeUndefined();
      expect(err.isOperational).toBe(true);
    });

    it('sets isOperational to false when specified', () => {
      const err = new AppError(
        'Bug',
        500,
        'INTERNAL_ERROR',
        undefined,
        false,
      );

      expect(err.isOperational).toBe(false);
    });

    it('has the name "AppError"', () => {
      const err = new AppError('test');
      expect(err.name).toBe('AppError');
    });

    it('is an instance of Error', () => {
      const err = new AppError('test');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(AppError);
    });

    it('captures a stack trace', () => {
      const err = new AppError('stack test');
      expect(err.stack).toBeDefined();
      expect(err.stack).toContain('AppError');
    });

    it('stack trace does not include the AppError constructor', () => {
      const err = new AppError('stack test');
      // The first frame should NOT be the constructor itself
      // (Error.captureStackTrace excludes it)
      const lines = (err.stack || '').split('\n');
      // First line is the error message, subsequent lines are stack frames
      const firstFrame = lines[1] || '';
      expect(firstFrame).not.toContain('new AppError');
    });
  });

  // =========================================================================
  // Error serialization (what an API response handler would extract)
  // =========================================================================
  describe('serialization for API responses', () => {
    it('can be serialized to a standard API error response', () => {
      const err = new AppError('Not found', 404, 'RESOURCE_NOT_FOUND', {
        resource: 'Meeting',
        id: 'mtg-999',
      });

      const serialized = {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      };

      expect(serialized).toEqual({
        success: false,
        error: {
          code: 'RESOURCE_NOT_FOUND',
          message: 'Not found',
          details: { resource: 'Meeting', id: 'mtg-999' },
        },
      });
    });

    it('serialization omits details when undefined', () => {
      const err = new AppError('Server error', 500, 'INTERNAL_ERROR');

      const serialized = {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      };

      expect(serialized.error).not.toHaveProperty('details');
    });
  });

  // =========================================================================
  // Errors factory functions
  // =========================================================================
  describe('Errors factory', () => {
    describe('notFound()', () => {
      it('creates a 404 error with resource name', () => {
        const err = Errors.notFound('Meeting');

        expect(err.statusCode).toBe(404);
        expect(err.code).toBe('MEETING_NOT_FOUND');
        expect(err.message).toBe('Meeting not found');
        expect(err.isOperational).toBe(true);
      });

      it('includes ID in message when provided', () => {
        const err = Errors.notFound('Meeting', 'mtg-123');

        expect(err.message).toBe('Meeting with id mtg-123 not found');
        expect(err.code).toBe('MEETING_NOT_FOUND');
      });

      it('uppercases multi-word resource names', () => {
        const err = Errors.notFound('agent task');

        expect(err.code).toBe('AGENT TASK_NOT_FOUND');
      });
    });

    describe('validation()', () => {
      it('creates a 400 error with VALIDATION_ERROR code', () => {
        const err = Errors.validation('Invalid email format', {
          field: 'email',
          value: 'not-an-email',
        });

        expect(err.statusCode).toBe(400);
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.message).toBe('Invalid email format');
        expect(err.details).toEqual({
          field: 'email',
          value: 'not-an-email',
        });
      });

      it('works without details', () => {
        const err = Errors.validation('Bad input');
        expect(err.details).toBeUndefined();
      });
    });

    describe('unauthorized()', () => {
      it('creates a 401 error with default message', () => {
        const err = Errors.unauthorized();

        expect(err.statusCode).toBe(401);
        expect(err.code).toBe('UNAUTHORIZED');
        expect(err.message).toBe('Unauthorized');
      });

      it('accepts custom message', () => {
        const err = Errors.unauthorized('Token expired');
        expect(err.message).toBe('Token expired');
      });
    });

    describe('forbidden()', () => {
      it('creates a 403 error with default message', () => {
        const err = Errors.forbidden();

        expect(err.statusCode).toBe(403);
        expect(err.code).toBe('FORBIDDEN');
        expect(err.message).toBe('Forbidden');
      });

      it('accepts custom message', () => {
        const err = Errors.forbidden('Insufficient permissions');
        expect(err.message).toBe('Insufficient permissions');
      });
    });

    describe('conflict()', () => {
      it('creates a 409 error', () => {
        const err = Errors.conflict('Engagement already exists');

        expect(err.statusCode).toBe(409);
        expect(err.code).toBe('CONFLICT');
        expect(err.message).toBe('Engagement already exists');
      });
    });

    describe('rateLimited()', () => {
      it('creates a 429 error with retryAfter', () => {
        const err = Errors.rateLimited(60);

        expect(err.statusCode).toBe(429);
        expect(err.code).toBe('RATE_LIMITED');
        expect(err.message).toBe('Too many requests');
        expect(err.details).toEqual({ retryAfter: 60 });
      });

      it('works without retryAfter', () => {
        const err = Errors.rateLimited();
        expect(err.details).toEqual({ retryAfter: undefined });
      });
    });

    describe('externalService()', () => {
      it('creates a 502 error with service details', () => {
        const err = Errors.externalService('Jira', 'Connection timeout');

        expect(err.statusCode).toBe(502);
        expect(err.code).toBe('EXTERNAL_SERVICE_ERROR');
        expect(err.message).toBe('External service error: Jira');
        expect(err.details).toEqual({
          service: 'Jira',
          originalMessage: 'Connection timeout',
        });
      });
    });

    describe('internal()', () => {
      it('creates a 500 error with isOperational=false', () => {
        const err = Errors.internal('Unexpected null pointer');

        expect(err.statusCode).toBe(500);
        expect(err.code).toBe('INTERNAL_ERROR');
        expect(err.message).toBe('Unexpected null pointer');
        expect(err.isOperational).toBe(false);
      });

      it('uses default message when none provided', () => {
        const err = Errors.internal();
        expect(err.message).toBe('Internal server error');
      });
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================
  describe('edge cases', () => {
    it('handles empty string message', () => {
      const err = new AppError('');
      expect(err.message).toBe('');
    });

    it('handles very long error message', () => {
      const longMsg = 'x'.repeat(10_000);
      const err = new AppError(longMsg);
      expect(err.message).toBe(longMsg);
    });

    it('handles special characters in message', () => {
      const msg = 'Error: <script>alert("xss")</script> & "quotes"';
      const err = new AppError(msg, 400, 'TEST');
      expect(err.message).toBe(msg);
    });

    it('details can contain nested objects', () => {
      const err = new AppError('test', 400, 'TEST', {
        errors: [
          { field: 'name', message: 'Required' },
          { field: 'email', message: 'Invalid' },
        ],
        meta: { requestId: 'req-123' },
      });

      expect(err.details?.errors).toHaveLength(2);
    });

    it('all factory errors are instances of AppError', () => {
      const factories = [
        Errors.notFound('Resource'),
        Errors.validation('Bad'),
        Errors.unauthorized(),
        Errors.forbidden(),
        Errors.conflict('Dup'),
        Errors.rateLimited(),
        Errors.externalService('S', 'M'),
        Errors.internal(),
      ];

      for (const err of factories) {
        expect(err).toBeInstanceOf(AppError);
        expect(err).toBeInstanceOf(Error);
      }
    });
  });
});
