import { describe, it, expect } from 'vitest';
import { parseApprovalIntent } from '../twilio-whatsapp.handler.js';

describe('parseApprovalIntent', () => {
  const token = 'a1b2c3d4e5f6'; // 12 hex

  describe('APPROVE variants', () => {
    it('recognises APPROVE <token>', () => {
      expect(parseApprovalIntent(`APPROVE ${token}`)).toEqual({
        action: 'approve',
        token,
      });
    });

    it('recognises A <token> shorthand', () => {
      expect(parseApprovalIntent(`A ${token}`)).toEqual({
        action: 'approve',
        token,
      });
    });

    it('is case-insensitive', () => {
      expect(parseApprovalIntent(`approve ${token}`)).toEqual({
        action: 'approve',
        token,
      });
      expect(parseApprovalIntent(`a ${token.toUpperCase()}`)).toEqual({
        action: 'approve',
        token,
      });
    });

    it('tolerates surrounding text', () => {
      expect(parseApprovalIntent(`hey I'll APPROVE ${token} thanks`)).toEqual({
        action: 'approve',
        token,
      });
    });
  });

  describe('REJECT variants', () => {
    it('recognises REJECT <token>', () => {
      expect(parseApprovalIntent(`REJECT ${token}`)).toEqual({
        action: 'reject',
        token,
      });
    });

    it('captures trailing reason', () => {
      expect(parseApprovalIntent(`REJECT ${token} needs more numbers`)).toEqual({
        action: 'reject',
        token,
        reason: 'needs more numbers',
      });
    });

    it('recognises R <token> shorthand', () => {
      expect(parseApprovalIntent(`R ${token}`)).toEqual({
        action: 'reject',
        token,
      });
    });

    it('captures reason with R shorthand', () => {
      expect(parseApprovalIntent(`R ${token} security concerns`)).toEqual({
        action: 'reject',
        token,
        reason: 'security concerns',
      });
    });
  });

  describe('Rejections (no match)', () => {
    it('returns null for bare approve (no token)', () => {
      expect(parseApprovalIntent('approve')).toBeNull();
    });

    it('returns null for greetings', () => {
      expect(parseApprovalIntent('hi')).toBeNull();
      expect(parseApprovalIntent('thanks')).toBeNull();
    });

    it('returns null for wrong-length hex', () => {
      expect(parseApprovalIntent('APPROVE a1b2c3')).toBeNull();
      expect(parseApprovalIntent(`APPROVE ${token}00`)).toBeNull();
    });

    it('returns null for non-hex characters', () => {
      expect(parseApprovalIntent('APPROVE g1h2i3j4k5l6')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseApprovalIntent('')).toBeNull();
    });
  });

  describe('APPROVE takes precedence over REJECT on ambiguous input', () => {
    it('uses the first matching action', () => {
      // Implementation currently favours APPROVE — lock the behaviour in.
      const result = parseApprovalIntent(
        `APPROVE ${token} actually REJECT a0a0a0a0a0a0`,
      );
      expect(result?.action).toBe('approve');
      expect(result?.token).toBe(token);
    });
  });
});
