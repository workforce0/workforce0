// mvp/src/lib/__tests__/webhook-verify.test.ts
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  verifyHmacSignature,
  verifyJiraSignature,
  verifyGChatToken,
  verifyWebhook,
} from '../webhook-verify.js';

function makeHmac(payload: string, secret: string, algo = 'sha256'): string {
  return crypto.createHmac(algo, secret).update(payload, 'utf8').digest('hex');
}

describe('Webhook Signature Verification', () => {
  const secret = 'test-webhook-secret-32chars-long!';
  const payload = '{"event":"test","data":{"id":"123"}}';

  // ---- HMAC-SHA256 ----

  describe('verifyHmacSignature', () => {
    it('should verify a valid HMAC-SHA256 signature', () => {
      const sig = makeHmac(payload, secret);
      expect(verifyHmacSignature(payload, sig, secret)).toBe(true);
    });

    it('should reject an invalid signature', () => {
      expect(verifyHmacSignature(payload, 'deadbeef'.repeat(8), secret)).toBe(false);
    });

    it('should reject a tampered payload', () => {
      const sig = makeHmac(payload, secret);
      expect(verifyHmacSignature(payload + 'tampered', sig, secret)).toBe(false);
    });

    it('should reject wrong secret', () => {
      const sig = makeHmac(payload, 'wrong-secret');
      expect(verifyHmacSignature(payload, sig, secret)).toBe(false);
    });

    it('should reject signatures of different length', () => {
      expect(verifyHmacSignature(payload, 'abc', secret)).toBe(false);
    });

    it('should handle non-hex signature gracefully', () => {
      expect(verifyHmacSignature(payload, 'not-valid-hex!!!', secret)).toBe(false);
    });
  });

  // ---- Jira ----

  describe('verifyJiraSignature', () => {
    it('should verify a valid Jira signature with sha256= prefix', () => {
      const sig = makeHmac(payload, secret);
      expect(verifyJiraSignature(payload, `sha256=${sig}`, secret)).toBe(true);
    });

    it('should verify a valid Jira signature without prefix', () => {
      const sig = makeHmac(payload, secret);
      expect(verifyJiraSignature(payload, sig, secret)).toBe(true);
    });

    it('should reject an invalid Jira signature', () => {
      expect(verifyJiraSignature(payload, 'sha256=' + 'ab'.repeat(32), secret)).toBe(false);
    });
  });

  // ---- Google Chat ----

  describe('verifyGChatToken', () => {
    it('should verify a valid bearer token', () => {
      expect(verifyGChatToken('Bearer my-token-123', 'my-token-123')).toBe(true);
    });

    it('should verify a raw token without Bearer prefix', () => {
      expect(verifyGChatToken('my-token-123', 'my-token-123')).toBe(true);
    });

    it('should reject an invalid token', () => {
      expect(verifyGChatToken('Bearer wrong-token', 'my-token-123')).toBe(false);
    });

    it('should reject tokens of different length', () => {
      expect(verifyGChatToken('Bearer short', 'much-longer-token')).toBe(false);
    });
  });

  // ---- Generic verifyWebhook ----

  describe('verifyWebhook', () => {
    it('should verify Jira webhook', () => {
      const sig = makeHmac(payload, secret);
      const result = verifyWebhook('jira', payload, { 'x-hub-signature': `sha256=${sig}` }, secret);
      expect(result.verified).toBe(true);
    });

    it('should fail Jira webhook without header', () => {
      const result = verifyWebhook('jira', payload, {}, secret);
      expect(result.verified).toBe(false);
      expect(result.error).toContain('X-Hub-Signature');
    });

    it('should verify Google Chat webhook', () => {
      const result = verifyWebhook('gchat', payload, { 'authorization': 'Bearer token123' }, 'token123');
      expect(result.verified).toBe(true);
    });

    it('should fail Google Chat webhook without header', () => {
      const result = verifyWebhook('gchat', payload, {}, 'token123');
      expect(result.verified).toBe(false);
      expect(result.error).toContain('Authorization');
    });
  });
});
