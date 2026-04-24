/**
 * Unit tests for WorkOSService.
 *
 * Tests:
 * 1. Constructor behavior (enabled/disabled)
 * 2. Authorization URL generation
 * 3. Profile exchange
 * 4. Graceful disabled state
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetAuthorizationUrl = vi.fn();
const mockGetProfileAndToken = vi.fn();
const mockListOrganizations = vi.fn();

vi.mock('@workos-inc/node', () => {
  class MockWorkOS {
    sso = {
      getAuthorizationUrl: mockGetAuthorizationUrl,
      getProfileAndToken: mockGetProfileAndToken,
    };
    organizations = {
      listOrganizations: mockListOrganizations,
    };
    constructor(_apiKey: string) {}
  }
  return { WorkOS: MockWorkOS };
});

vi.mock('../../../lib/logger.js', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { WorkOSService } from '../workos.service.js';

describe('WorkOSService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('disables service when API key is missing', () => {
      const service = new WorkOSService(undefined, 'client-id');
      expect(service.isEnabled()).toBe(false);
    });

    it('disables service when client ID is missing', () => {
      const service = new WorkOSService('api-key', undefined);
      expect(service.isEnabled()).toBe(false);
    });

    it('enables service when both keys are provided', () => {
      const service = new WorkOSService('api-key', 'client-id');
      expect(service.isEnabled()).toBe(true);
    });
  });

  describe('getAuthorizationUrl', () => {
    it('generates authorization URL', () => {
      const service = new WorkOSService('api-key', 'client-id');
      mockGetAuthorizationUrl.mockReturnValue('https://api.workos.com/sso/authorize?...');

      const url = service.getAuthorizationUrl('https://app.example.com/callback', {
        organization: 'org_123',
      });

      expect(url).toBe('https://api.workos.com/sso/authorize?...');
      expect(mockGetAuthorizationUrl).toHaveBeenCalledWith({
        clientId: 'client-id',
        redirectUri: 'https://app.example.com/callback',
        organization: 'org_123',
        connection: undefined,
        domainHint: undefined,
        loginHint: undefined,
        state: undefined,
      });
    });

    it('throws when service is disabled', () => {
      const service = new WorkOSService(undefined, undefined);
      expect(() => service.getAuthorizationUrl('https://example.com/callback')).toThrow(
        'WorkOS SSO is not configured'
      );
    });
  });

  describe('getProfile', () => {
    it('exchanges code for profile', async () => {
      const service = new WorkOSService('api-key', 'client-id');
      mockGetProfileAndToken.mockResolvedValue({
        profile: {
          id: 'prof_123',
          email: 'user@example.com',
          firstName: 'Jane',
          lastName: 'Doe',
          organizationId: 'org_456',
        },
        accessToken: 'at_abc',
      });

      const profile = await service.getProfile('auth-code');

      expect(profile).toEqual({
        workosId: 'prof_123',
        email: 'user@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        organizationId: 'org_456',
      });
      expect(mockGetProfileAndToken).toHaveBeenCalledWith({
        code: 'auth-code',
        clientId: 'client-id',
      });
    });

    it('handles missing names gracefully', async () => {
      const service = new WorkOSService('api-key', 'client-id');
      mockGetProfileAndToken.mockResolvedValue({
        profile: {
          id: 'prof_789',
          email: 'user@example.com',
          firstName: null,
          lastName: null,
        },
        accessToken: 'at_xyz',
        organizationId: null,
      });

      const profile = await service.getProfile('code');

      expect(profile.firstName).toBe('');
      expect(profile.lastName).toBe('');
      expect(profile.organizationId).toBeUndefined();
    });

    it('throws when service is disabled', async () => {
      const service = new WorkOSService(undefined, undefined);
      await expect(service.getProfile('code')).rejects.toThrow('WorkOS SSO is not configured');
    });
  });

  describe('testConnection', () => {
    it('returns true when API responds', async () => {
      const service = new WorkOSService('api-key', 'client-id');
      mockListOrganizations.mockResolvedValue({ data: [] });

      const result = await service.testConnection();
      expect(result).toBe(true);
    });

    it('returns false when API fails', async () => {
      const service = new WorkOSService('api-key', 'client-id');
      mockListOrganizations.mockRejectedValue(new Error('Unauthorized'));

      const result = await service.testConnection();
      expect(result).toBe(false);
    });

    it('returns false when disabled', async () => {
      const service = new WorkOSService(undefined, undefined);
      const result = await service.testConnection();
      expect(result).toBe(false);
    });
  });
});
