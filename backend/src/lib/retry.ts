/**
 * Retry utility with exponential backoff for transient failures.
 * Used by AI model clients to handle rate limits and temporary API outages
 * without wasting BullMQ job-level retries.
 */

import { createChildLogger } from './logger.js';

const logger = createChildLogger({ module: 'retry' });

interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in ms (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in ms (default: 30000) */
  maxDelayMs?: number;
  /** Jitter factor 0-1 to randomize delay (default: 0.2) */
  jitter?: number;
  /** Label for logging */
  label?: string;
  /** Custom predicate to determine if error is retryable */
  isRetryable?: (error: unknown) => boolean;
}

/** Default: retry on rate limits (429), server errors (5xx), and network errors */
function defaultIsRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Rate limits
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) return true;
    // Server errors
    if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) return true;
    // Network errors
    if (msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('fetch failed')) return true;
  }
  // Check for HTTP status-like properties
  const status = (error as any)?.status || (error as any)?.statusCode;
  if (typeof status === 'number') {
    return status === 429 || (status >= 500 && status <= 599);
  }
  return false;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    jitter = 0.2,
    label = 'operation',
    isRetryable = defaultIsRetryable,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= maxRetries || !isRetryable(error)) {
        throw error;
      }

      const baseDelay = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs);
      const jitterMs = baseDelay * jitter * Math.random();
      const delay = Math.round(baseDelay + jitterMs);

      logger.warn(`${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms`, {
        error: (error as Error).message,
        attempt: attempt + 1,
        nextRetryMs: delay,
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
