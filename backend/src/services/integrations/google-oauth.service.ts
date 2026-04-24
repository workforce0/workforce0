/**
 * =============================================================================
 * GOOGLE OAUTH SERVICE
 * =============================================================================
 *
 * Manages Google OAuth 2.0 tokens for per-user Google Meet integration.
 * Handles authorization, token exchange, encrypted storage, refresh, and
 * connection status.
 *
 * @module services/integrations/google-oauth
 */

import { google, Auth } from 'googleapis';
import { PrismaClient } from '../../../prisma/generated/client/index.js';
import { encrypt, decrypt } from '../../lib/encryption.js';
import { createChildLogger } from '../../lib/logger.js';

const logger = createChildLogger({ service: 'GoogleOAuthService' });

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: string;
}

export class GoogleOAuthService {
  private readonly oauth2Client: Auth.OAuth2Client | null = null;
  private readonly enabled: boolean;
  private readonly encryptionKey: string;
  private readonly prisma: PrismaClient;

  constructor(config: GoogleOAuthConfig, prisma: PrismaClient) {
    this.encryptionKey = config.encryptionKey;
    this.prisma = prisma;
    this.enabled = !!(config.clientId && config.clientSecret);

    if (this.enabled) {
      this.oauth2Client = new google.auth.OAuth2(
        config.clientId,
        config.clientSecret,
        config.redirectUri
      );
      logger.info('GoogleOAuthService initialized');
    } else {
      logger.info('GoogleOAuthService disabled — no GOOGLE_CLIENT_ID');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Generate the Google OAuth consent URL.
   */
  getAuthorizationUrl(state: string): string {
    if (!this.oauth2Client) throw new Error('GoogleOAuthService not enabled');

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      state,
      prompt: 'consent',
    });
  }

  /**
   * Exchange authorization code for tokens and fetch user email.
   */
  async exchangeCode(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    email: string;
  }> {
    if (!this.oauth2Client) throw new Error('GoogleOAuthService not enabled');

    const { tokens } = await this.oauth2Client.getToken(code);

    this.oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    return {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token!,
      expiresAt: new Date(tokens.expiry_date!),
      email: userInfo.email!,
    };
  }

  /**
   * Save encrypted tokens to database (upsert per tenant+user).
   */
  async saveTokens(
    tenantId: string,
    userId: string,
    tokens: { accessToken: string; refreshToken: string; expiresAt: Date; email: string }
  ): Promise<void> {
    const encryptedAccess = encrypt(tokens.accessToken, this.encryptionKey);
    const encryptedRefresh = encrypt(tokens.refreshToken, this.encryptionKey);

    await this.prisma.googleOAuthToken.upsert({
      where: { tenantId_userId: { tenantId, userId } },
      create: {
        tenantId,
        userId,
        email: tokens.email,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiresAt: tokens.expiresAt,
      },
      update: {
        email: tokens.email,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        expiresAt: tokens.expiresAt,
      },
    });

    logger.info('OAuth tokens saved', { tenantId, userId, email: tokens.email });
  }

  /**
   * Retrieve and decrypt tokens for a user.
   */
  async getTokens(tenantId: string, userId: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    email: string;
  } | null> {
    const record = await this.prisma.googleOAuthToken.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });

    if (!record) return null;

    return {
      accessToken: decrypt(record.accessToken, this.encryptionKey),
      refreshToken: decrypt(record.refreshToken, this.encryptionKey),
      expiresAt: record.expiresAt,
      email: record.email,
    };
  }

  /**
   * Refresh an expired access token using the stored refresh token.
   */
  async refreshAccessToken(tenantId: string, userId: string): Promise<string | null> {
    if (!this.oauth2Client) return null;

    const tokens = await this.getTokens(tenantId, userId);
    if (!tokens) return null;

    this.oauth2Client.setCredentials({ refresh_token: tokens.refreshToken });
    const { credentials } = await this.oauth2Client.refreshAccessToken();

    const newAccess = credentials.access_token!;
    const encryptedAccess = encrypt(newAccess, this.encryptionKey);

    await this.prisma.googleOAuthToken.update({
      where: { tenantId_userId: { tenantId, userId } },
      data: {
        accessToken: encryptedAccess,
        expiresAt: new Date(credentials.expiry_date!),
      },
    });

    logger.info('Access token refreshed', { tenantId, userId });
    return newAccess;
  }

  /**
   * Remove OAuth tokens (disconnect Google account).
   */
  async disconnect(tenantId: string, userId: string): Promise<void> {
    await this.prisma.googleOAuthToken.deleteMany({
      where: { tenantId, userId },
    });
    logger.info('Google OAuth disconnected', { tenantId, userId });
  }

  /**
   * Check whether a user has connected their Google account.
   */
  async getConnectionStatus(tenantId: string, userId: string): Promise<{
    connected: boolean;
    email?: string;
  }> {
    const record = await this.prisma.googleOAuthToken.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });

    return {
      connected: !!record,
      email: record?.email,
    };
  }
}
