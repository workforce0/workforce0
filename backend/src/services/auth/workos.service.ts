/**
 * =============================================================================
 * WORKOS SSO SERVICE
 * =============================================================================
 *
 * Provides Single Sign-On (SSO) via WorkOS SDK.
 *
 * When enabled (WORKOS_API_KEY + WORKOS_CLIENT_ID configured), this service:
 * - Generates SSO authorization URLs (redirect users to their IdP)
 * - Exchanges authorization codes for user profiles
 * - Supports organization-level SSO (Okta, Azure AD, Google Workspace, etc.)
 *
 * When disabled (missing env vars), all methods return graceful defaults.
 *
 * @module services/auth/workos
 */

import { WorkOS } from '@workos-inc/node';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'WorkOSService' });

export interface SSOProfile {
  workosId: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationId?: string;
}

export class WorkOSService {
  private readonly client: WorkOS | null;
  private readonly clientId: string;
  private readonly enabled: boolean;

  constructor(apiKey?: string, clientId?: string) {
    if (!apiKey || !clientId) {
      this.enabled = false;
      this.client = null;
      this.clientId = '';
      logger.warn('WorkOS not configured — SSO disabled');
      return;
    }

    this.enabled = true;
    this.client = new WorkOS(apiKey);
    this.clientId = clientId;
    logger.info('WorkOS SSO service initialized');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Generate an SSO authorization URL.
   *
   * The user should be redirected to this URL to start the SSO flow.
   *
   * @param redirectUri - Where WorkOS sends the user after authentication
   * @param options - Optional: organization ID, connection ID, domain hint, state
   */
  getAuthorizationUrl(
    redirectUri: string,
    options: {
      organization?: string;
      connection?: string;
      provider?: string;
      domainHint?: string;
      loginHint?: string;
      state?: string;
    } = {}
  ): string {
    if (!this.client) {
      throw new Error('WorkOS SSO is not configured');
    }

    // WorkOS v8 requires exactly one of: connection, organization, or provider
    const baseOptions = {
      clientId: this.clientId,
      redirectUri,
      domainHint: options.domainHint,
      loginHint: options.loginHint,
      state: options.state,
    };

    if (options.connection) {
      return this.client.sso.getAuthorizationUrl({ ...baseOptions, connection: options.connection });
    }
    if (options.organization) {
      return this.client.sso.getAuthorizationUrl({ ...baseOptions, organization: options.organization });
    }
    // Default to AuthKit provider
    return this.client.sso.getAuthorizationUrl({ ...baseOptions, provider: options.provider || 'authkit' });
  }

  /**
   * Exchange an authorization code for a user profile.
   *
   * Called in the SSO callback handler after WorkOS redirects back.
   *
   * @param code - Authorization code from the callback query params
   * @returns User profile with email, name, and WorkOS IDs
   */
  async getProfile(code: string): Promise<SSOProfile> {
    if (!this.client) {
      throw new Error('WorkOS SSO is not configured');
    }

    const { profile } = await this.client.sso.getProfileAndToken({
      code,
      clientId: this.clientId,
    });

    return {
      workosId: profile.id,
      email: profile.email,
      firstName: profile.firstName || '',
      lastName: profile.lastName || '',
      organizationId: profile.organizationId || undefined,
    };
  }

  /**
   * Test connection to WorkOS.
   */
  async testConnection(): Promise<boolean> {
    if (!this.client) return false;

    try {
      // List organizations as a simple connectivity check
      await this.client.organizations.listOrganizations({ limit: 1 });
      return true;
    } catch {
      return false;
    }
  }
}
