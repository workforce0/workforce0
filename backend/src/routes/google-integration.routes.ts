/**
 * =============================================================================
 * GOOGLE INTEGRATION ROUTES
 * =============================================================================
 *
 * OAuth flow for Google Meet integration.
 *
 * Endpoints:
 * ----------
 * GET    /integrations/google/authorize  → Start OAuth flow
 * GET    /integrations/google/callback   → Handle OAuth callback
 * DELETE /integrations/google            → Disconnect Google account
 * GET    /integrations/google/status     → Check connection status
 *
 * @module routes/google-integration
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes } from 'crypto';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger({ route: 'google-integration' });

export async function googleIntegrationRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /integrations/google/authorize
   * Returns the Google OAuth consent URL for the frontend to redirect to.
   */
  fastify.get('/google/authorize', async (request: FastifyRequest, reply: FastifyReply) => {
    const googleOAuth = fastify.services.googleOAuthService;
    if (!googleOAuth) {
      return reply.status(503).send({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Google integration not configured.' },
      });
    }

    // Generate CSRF state token and store in Redis (5 min expiry)
    const state = randomBytes(32).toString('hex');
    const tenantId = (request as any).tenantId as string;
    const userId = (request as any).userId as string;

    await fastify.services.redis.set(
      `google_oauth_state:${state}`,
      JSON.stringify({ tenantId, userId }),
      'EX',
      300
    );

    const authUrl = googleOAuth.getAuthorizationUrl(state);

    return reply.send({ success: true, data: { authUrl } });
  });

  /**
   * GET /integrations/google/callback
   * Handles the OAuth callback from Google. Exchanges code for tokens.
   */
  fastify.get('/google/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    const googleOAuth = fastify.services.googleOAuthService;
    if (!googleOAuth) {
      return reply.status(503).send({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Google integration not configured.' },
      });
    }

    const { code, state } = request.query as { code?: string; state?: string };

    if (!code || !state) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Missing code or state parameter.' },
      });
    }

    // Validate CSRF state
    const stored = await fastify.services.redis.get(`google_oauth_state:${state}`);
    if (!stored) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_STATE', message: 'OAuth state expired or invalid. Please try again.' },
      });
    }
    await fastify.services.redis.del(`google_oauth_state:${state}`);

    const { tenantId, userId } = JSON.parse(stored);

    try {
      const tokens = await googleOAuth.exchangeCode(code);
      await googleOAuth.saveTokens(tenantId, userId, tokens);

      logger.info('Google OAuth connected', { tenantId, email: tokens.email });

      // Redirect to settings page with success indicator
      return reply.redirect('/settings?google=connected');
    } catch (err) {
      logger.error('Google OAuth exchange failed', { error: (err as Error).message });
      return reply.redirect('/settings?google=error');
    }
  });

  /**
   * DELETE /integrations/google
   * Disconnect Google account for the current user.
   */
  fastify.delete('/google', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const userId = (request as any).userId as string;

    const googleOAuth = fastify.services.googleOAuthService;
    if (googleOAuth) {
      await googleOAuth.disconnect(tenantId, userId);
    }

    return reply.send({ success: true, message: 'Google account disconnected.' });
  });

  /**
   * GET /integrations/google/status
   * Check whether the current user has a connected Google account.
   */
  fastify.get('/google/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId as string;
    const userId = (request as any).userId as string;

    const googleOAuth = fastify.services.googleOAuthService;
    if (!googleOAuth) {
      return reply.send({
        success: true,
        data: { available: false, connected: false },
      });
    }

    const status = await googleOAuth.getConnectionStatus(tenantId, userId);

    return reply.send({
      success: true,
      data: { available: true, ...status },
    });
  });
}
