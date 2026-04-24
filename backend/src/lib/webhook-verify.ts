// mvp/src/lib/webhook-verify.ts

import crypto from 'node:crypto';
import { createChildLogger } from './logger.js';

const log = createChildLogger({ service: 'WebhookVerify' });

/**
 * Verify an HMAC-SHA256 webhook signature.
 *
 * Compares the expected signature against the received one using
 * timing-safe comparison to prevent timing attacks.
 *
 * @param payload   - Raw request body string
 * @param signature - Signature from the webhook header
 * @param secret    - Shared secret for HMAC computation
 * @param algorithm - Hash algorithm (default: sha256)
 * @returns true if signature is valid
 */
export function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string,
  algorithm = 'sha256',
): boolean {
  try {
    const expected = crypto
      .createHmac(algorithm, secret)
      .update(payload, 'utf8')
      .digest('hex');

    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');

    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  } catch (err) {
    log.error({ error: (err as Error).message }, 'Signature verification error');
    return false;
  }
}

/**
 * Verify a Jira webhook signature.
 *
 * Jira sends HMAC-SHA256 in the X-Hub-Signature header as "sha256=<hex>".
 */
export function verifyJiraSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
): boolean {
  const signature = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice(7)
    : signatureHeader;
  return verifyHmacSignature(payload, signature, secret);
}

/**
 * Verify a Google Chat webhook token.
 *
 * Google Chat uses a bearer token in the Authorization header.
 * Simple constant-time comparison.
 */
export function verifyGChatToken(
  authHeader: string,
  expectedToken: string,
): boolean {
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expectedToken);

  if (tokenBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
}

/**
 * Generic webhook verification result.
 */
export interface WebhookVerifyResult {
  verified: boolean;
  error?: string;
}

/**
 * Verify a webhook based on provider type.
 *
 * @param provider  - The webhook provider ("jira" | "gchat")
 * @param payload   - Raw request body
 * @param headers   - Request headers (relevant signature headers)
 * @param secret    - Shared secret/token for verification
 */
export function verifyWebhook(
  provider: 'jira' | 'gchat',
  payload: string,
  headers: Record<string, string | undefined>,
  secret: string,
): WebhookVerifyResult {
  switch (provider) {
    case 'jira': {
      const sig = headers['x-hub-signature'];
      if (!sig) return { verified: false, error: 'Missing X-Hub-Signature header' };
      return { verified: verifyJiraSignature(payload, sig, secret) };
    }
    case 'gchat': {
      const auth = headers['authorization'];
      if (!auth) return { verified: false, error: 'Missing Authorization header' };
      return { verified: verifyGChatToken(auth, secret) };
    }
    default:
      return { verified: false, error: `Unknown provider: ${provider}` };
  }
}
