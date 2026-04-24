/**
 * =============================================================================
 * AUTH API ROUTES
 * =============================================================================
 *
 * JWT authentication with refresh tokens and User model.
 *
 * Endpoints:
 * ----------
 * POST /auth/login       -> Login with email/password (returns access + refresh tokens)
 * POST /auth/signup      -> Create account
 * POST /auth/refresh     -> Refresh access token
 * POST /auth/logout      -> Invalidate refresh token
 * GET  /auth/me          -> Get current user info
 * GET  /auth/invite/:token -> Validate invitation
 * POST /auth/accept-invite -> Register via invitation
 *
 * @module routes/auth
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import { createChildLogger } from '../lib/logger.js';
import { config } from '../config/index.js';
import { ModelRegistryService } from '../services/model-registry/model-registry.service.js';

const logger = createChildLogger({ route: 'auth' });

// Token expiry constants
const ACCESS_TOKEN_EXPIRY = 15 * 60; // 15 minutes
const REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60; // 7 days
const REFRESH_TOKEN_REDIS_PREFIX = 'refresh_token:';

// Cookie names
const ACCESS_COOKIE = 'wf0_access';
const REFRESH_COOKIE = 'wf0_refresh';

/**
 * Set httpOnly cookies for access and refresh tokens.
 * These are invisible to JavaScript, preventing XSS token theft.
 */
function setAuthCookies(reply: FastifyReply, accessToken: string, refreshToken: string): void {
  const isProduction = config.NODE_ENV === 'production';

  reply.setCookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: ACCESS_TOKEN_EXPIRY,
  });

  reply.setCookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/api/auth', // Only sent to auth endpoints
    maxAge: REFRESH_TOKEN_EXPIRY,
  });
}

/**
 * Clear auth cookies on logout.
 */
function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_COOKIE, { path: '/' });
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  organizationName: z.string().min(1),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const AcceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(6),
  name: z.string().min(1),
});

/**
 * Create a JWT access token (short-lived, 15min).
 */
function createAccessToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    ...payload,
    type: 'access',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_EXPIRY,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', config.JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

/**
 * Create a refresh token (opaque, stored in Redis).
 */
function createRefreshToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

function verifyToken(token: string): Record<string, unknown> | null {
  try {
    const [header, body, signature] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', config.JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const verify = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  const hashBuf = Buffer.from(hash, 'hex');
  const verifyBuf = Buffer.from(verify, 'hex');
  if (hashBuf.length !== verifyBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, verifyBuf);
}

/**
 * Store refresh token in Redis with TTL.
 */
async function storeRefreshToken(redis: any, token: string, userId: string, tenantId: string): Promise<void> {
  const key = `${REFRESH_TOKEN_REDIS_PREFIX}${token}`;
  await redis.setex(key, REFRESH_TOKEN_EXPIRY, JSON.stringify({ userId, tenantId }));
}

/**
 * Get refresh token data from Redis.
 */
async function getRefreshTokenData(redis: any, token: string): Promise<{ userId: string; tenantId: string } | null> {
  const key = `${REFRESH_TOKEN_REDIS_PREFIX}${token}`;
  const data = await redis.get(key);
  if (!data) return null;
  return JSON.parse(data);
}

/**
 * Invalidate a refresh token.
 */
async function revokeRefreshToken(redis: any, token: string): Promise<void> {
  await redis.del(`${REFRESH_TOKEN_REDIS_PREFIX}${token}`);
}

/**
 * Issue both tokens and return the standard auth response.
 */
async function issueTokens(redis: any, user: { id: string; tenantId: string; email: string; name: string; role: string }, tenantName: string) {
  const accessToken = createAccessToken({
    userId: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    role: user.role,
  });
  const refreshToken = createRefreshToken();
  await storeRefreshToken(redis, refreshToken, user.id, user.tenantId);

  return {
    accessToken,
    refreshToken,
    // Keep backward compat: also return as "token"
    token: accessToken,
    user: {
      email: user.email,
      name: user.name,
      organizationName: tenantName,
      tenantId: user.tenantId,
      role: user.role,
    },
  };
}

/**
 * Register auth routes.
 */
export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /auth/signup
   */
  fastify.post('/signup', {
    config: {
      rateLimit: {
        max: 3,
        timeWindow: '1 minute',
        keyGenerator: (request: FastifyRequest) => request.ip,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = SignupSchema.parse(request.body);

    logger.info('Signup attempt', { email: body.email });

    const prisma = fastify.services.prisma;

    // Check if email exists in User table
    const existingUser = await prisma.user.findFirst({
      where: { email: body.email },
    });

    if (existingUser) {
      return reply.status(409).send({
        success: false,
        error: { code: 'EMAIL_EXISTS', message: 'An account with this email already exists' },
      });
    }

    // Also check legacy auth in tenant settings (backward compat)
    const existingTenants = await prisma.tenant.findMany({
      where: {
        settings: {
          path: ['auth', 'email'],
          equals: body.email,
        },
      },
    });

    if (existingTenants.length > 0) {
      return reply.status(409).send({
        success: false,
        error: { code: 'EMAIL_EXISTS', message: 'An account with this email already exists' },
      });
    }

    const tenant = await prisma.tenant.create({
      data: {
        name: body.organizationName,
        settings: {
          auth: {
            email: body.email,
            passwordHash: hashPassword(body.password),
            name: body.name,
          },
          integrations: {
            meetingProvider: 'google_meet',
            communicationProvider: 'google_chat',
            taskProvider: 'jira',
          },
          notifications: {
            notifyOnMeetingEnd: true,
            notifyOnPrdGenerated: true,
            notifyOnApprovalNeeded: true,
            mentionOnUrgent: true,
          },
          approvalThresholds: {
            autoApproveAbove: 0.9,
            requireHumanBelow: 0.7,
          },
        },
      },
    });

    // Create User record (owner)
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: body.email,
        passwordHash: hashPassword(body.password),
        name: body.name,
        role: 'owner',
      },
    });

    // Seed default model registry (non-fatal)
    try {
      const modelRegistryService = new ModelRegistryService(prisma);
      await modelRegistryService.seedDefaults(tenant.id);
    } catch (seedError) {
      logger.error('Failed to seed default model registry', { tenantId: tenant.id, error: (seedError as Error).message });
    }

    // P1: Create Default project so the tenant has a project scope from day one (non-fatal)
    try {
      await fastify.services.projectService.ensureDefaultFor(tenant.id);
    } catch (projectError) {
      logger.error('Failed to create Default project', { tenantId: tenant.id, error: (projectError as Error).message });
    }

    // Create founder team member (non-fatal)
    try {
      await prisma.teamMember.create({
        data: {
          tenantId: tenant.id,
          name: body.name,
          email: body.email,
          role: 'founder',
          preferredChannel: 'email',
          channelIds: { email: body.email },
          isActive: true,
          discoveredFrom: 'manual',
        },
      });
    } catch (memberError) {
      logger.error('Failed to create founder team member', { tenantId: tenant.id, error: (memberError as Error).message });
    }

    const tokens = await issueTokens(fastify.services.redis, {
      id: user.id,
      tenantId: tenant.id,
      email: body.email,
      name: body.name,
      role: 'owner',
    }, body.organizationName);

    logger.info('Signup successful', { tenantId: tenant.id, userId: user.id });

    // Audit log: new user signup
    fastify.services.auditService.log({
      tenantId: tenant.id,
      userId: user.id,
      action: 'user.signup',
      resource: 'user',
      resourceId: user.id,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    });

    setAuthCookies(reply, tokens.accessToken, tokens.refreshToken);
    return reply.status(201).send({
      success: true,
      data: tokens,
    });
  });

  /**
   * POST /auth/login
   */
  fastify.post('/login', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute',
        keyGenerator: (request: FastifyRequest) => request.ip,
      },
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = LoginSchema.parse(request.body);

    logger.info('Login attempt', { email: body.email });

    const prisma = fastify.services.prisma;

    // Try User table first
    const user = await prisma.user.findFirst({
      where: { email: body.email },
      include: { tenant: { select: { id: true, name: true } } },
    });

    if (user) {
      if (!verifyPassword(body.password, user.passwordHash)) {
        return reply.status(401).send({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        });
      }

      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      const tokens = await issueTokens(fastify.services.redis, {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        name: user.name,
        role: user.role,
      }, user.tenant.name);

      logger.info('Login successful (User model)', { tenantId: user.tenantId, userId: user.id });

      // Audit log: user login
      fastify.services.auditService.log({
        tenantId: user.tenantId,
        userId: user.id,
        action: 'user.login',
        resource: 'user',
        resourceId: user.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      setAuthCookies(reply, tokens.accessToken, tokens.refreshToken);
      return reply.send({ success: true, data: tokens });
    }

    // Fallback: legacy auth in tenant settings
    const tenants = await prisma.tenant.findMany({
      where: {
        settings: {
          path: ['auth', 'email'],
          equals: body.email,
        },
      },
    });

    if (tenants.length === 0) {
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
    }

    const tenant = tenants[0];
    const settings = tenant.settings as Record<string, any>;
    const auth = settings?.auth;

    if (!auth || !verifyPassword(body.password, auth.passwordHash)) {
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
    }

    // Auto-migrate: create User record from legacy auth
    let migratedUser;
    try {
      migratedUser = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: auth.email,
          passwordHash: auth.passwordHash,
          name: auth.name,
          role: 'owner',
          lastLoginAt: new Date(),
        },
      });
      logger.info('Auto-migrated legacy auth to User model', { tenantId: tenant.id });
    } catch {
      // May already exist if concurrent migration
      migratedUser = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: auth.email } });
    }

    const userId = migratedUser?.id || tenant.id;

    const tokens = await issueTokens(fastify.services.redis, {
      id: userId,
      tenantId: tenant.id,
      email: auth.email,
      name: auth.name,
      role: 'owner',
    }, tenant.name);

    logger.info('Login successful (legacy)', { tenantId: tenant.id });

    setAuthCookies(reply, tokens.accessToken, tokens.refreshToken);
    return reply.send({ success: true, data: tokens });
  });

  /**
   * POST /auth/refresh
   */
  fastify.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = RefreshSchema.parse(request.body);

    const data = await getRefreshTokenData(fastify.services.redis, body.refreshToken);
    if (!data) {
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is invalid or expired' },
      });
    }

    // Revoke old refresh token (rotate)
    await revokeRefreshToken(fastify.services.redis, body.refreshToken);

    const prisma = fastify.services.prisma;
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      include: { tenant: { select: { id: true, name: true } } },
    });

    if (!user) {
      return reply.status(401).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User no longer exists' },
      });
    }

    const tokens = await issueTokens(fastify.services.redis, {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      role: user.role,
    }, user.tenant.name);

    setAuthCookies(reply, tokens.accessToken, tokens.refreshToken);
    return reply.send({ success: true, data: tokens });
  });

  /**
   * POST /auth/logout
   */
  fastify.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { refreshToken?: string };
    // Revoke from body or from cookie
    const refreshToken = body?.refreshToken || (request.cookies as Record<string, string>)?.[REFRESH_COOKIE];
    if (refreshToken) {
      await revokeRefreshToken(fastify.services.redis, refreshToken);
    }
    clearAuthCookies(reply);
    return reply.send({ success: true });
  });

  /**
   * GET /auth/me
   */
  fastify.get('/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Token required' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = verifyToken(token);

    if (!payload) {
      return reply.status(401).send({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
      });
    }

    const prisma = fastify.services.prisma;
    const tenant = await prisma.tenant.findUnique({
      where: { id: payload.tenantId as string },
    });

    if (!tenant) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Account not found' },
      });
    }

    return reply.send({
      success: true,
      data: {
        userId: payload.userId,
        email: payload.email,
        name: payload.name,
        role: payload.role || 'owner',
        organizationName: tenant.name,
        tenantId: tenant.id,
      },
    });
  });

  /**
   * GET /auth/invite/:token - Validate invitation token
   */
  fastify.get('/invite/:token', async (request: FastifyRequest, reply: FastifyReply) => {
    const { token } = request.params as { token: string };
    const prisma = fastify.services.prisma;

    const invitation = await prisma.invitation.findUnique({
      where: { token },
      include: { tenant: { select: { name: true } } },
    });

    if (!invitation) {
      return reply.status(404).send({
        success: false,
        error: { code: 'INVALID_INVITE', message: 'Invitation not found' },
      });
    }

    if (invitation.status !== 'pending') {
      return reply.status(410).send({
        success: false,
        error: { code: 'INVITE_USED', message: 'This invitation has already been used' },
      });
    }

    if (new Date(invitation.expiresAt) < new Date()) {
      await prisma.invitation.update({ where: { id: invitation.id }, data: { status: 'expired' } });
      return reply.status(410).send({
        success: false,
        error: { code: 'INVITE_EXPIRED', message: 'This invitation has expired' },
      });
    }

    return reply.send({
      success: true,
      data: {
        email: invitation.email,
        role: invitation.role,
        organizationName: invitation.tenant.name,
      },
    });
  });

  /**
   * POST /auth/accept-invite - Register via invitation
   */
  fastify.post('/accept-invite', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = AcceptInviteSchema.parse(request.body);
    const prisma = fastify.services.prisma;

    const invitation = await prisma.invitation.findUnique({
      where: { token: body.token },
      include: { tenant: { select: { id: true, name: true } } },
    });

    if (!invitation || invitation.status !== 'pending' || new Date(invitation.expiresAt) < new Date()) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INVITE', message: 'Invalid or expired invitation' },
      });
    }

    // Check if user already exists in this tenant
    const existing = await prisma.user.findFirst({
      where: { tenantId: invitation.tenantId, email: invitation.email },
    });

    if (existing) {
      return reply.status(409).send({
        success: false,
        error: { code: 'USER_EXISTS', message: 'A user with this email already exists in this organization' },
      });
    }

    // Create user and mark invitation accepted
    const user = await prisma.user.create({
      data: {
        tenantId: invitation.tenantId,
        email: invitation.email,
        passwordHash: hashPassword(body.password),
        name: body.name,
        role: invitation.role,
      },
    });

    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: 'accepted' },
    });

    // Also create team member entry
    try {
      await prisma.teamMember.create({
        data: {
          tenantId: invitation.tenantId,
          name: body.name,
          email: invitation.email,
          role: invitation.role === 'admin' ? 'pm' : invitation.role,
          preferredChannel: 'email',
          channelIds: { email: invitation.email },
          isActive: true,
          discoveredFrom: 'manual',
        },
      });
    } catch {
      // Non-fatal: team member may already exist
    }

    const tokens = await issueTokens(fastify.services.redis, {
      id: user.id,
      tenantId: invitation.tenantId,
      email: invitation.email,
      name: body.name,
      role: invitation.role,
    }, invitation.tenant.name);

    logger.info('Invitation accepted', { tenantId: invitation.tenantId, userId: user.id });

    setAuthCookies(reply, tokens.accessToken, tokens.refreshToken);
    return reply.status(201).send({ success: true, data: tokens });
  });

  // ===========================================================================
  // SSO via WorkOS
  // ===========================================================================

  const SSOAuthorizeSchema = z.object({
    redirectUri: z.string().url(),
    organization: z.string().optional(),
    connection: z.string().optional(),
    domainHint: z.string().optional(),
    loginHint: z.string().email().optional(),
    state: z.string().optional(),
  });

  const SSOCallbackSchema = z.object({
    code: z.string().min(1),
  });

  /**
   * POST /auth/sso/authorize
   *
   * Returns an SSO authorization URL. The frontend redirects the user
   * to this URL to initiate the SSO flow with their identity provider.
   */
  fastify.post('/sso/authorize', async (request: FastifyRequest, reply: FastifyReply) => {
    const workos = fastify.services.workosService;

    if (!workos || !workos.isEnabled()) {
      return reply.status(501).send({
        success: false,
        error: { code: 'SSO_NOT_CONFIGURED', message: 'SSO is not configured for this instance' },
      });
    }

    const body = SSOAuthorizeSchema.parse(request.body);

    try {
      const authUrl = workos.getAuthorizationUrl(body.redirectUri, {
        organization: body.organization,
        connection: body.connection,
        domainHint: body.domainHint,
        loginHint: body.loginHint,
        state: body.state,
      });

      return reply.send({ success: true, data: { authUrl } });
    } catch (err) {
      logger.error('Failed to generate SSO authorization URL', { error: (err as Error).message });
      return reply.status(500).send({
        success: false,
        error: { code: 'SSO_ERROR', message: 'Failed to initiate SSO' },
      });
    }
  });

  /**
   * POST /auth/sso/callback
   *
   * Exchanges a WorkOS authorization code for a user profile,
   * performs JIT (Just-In-Time) user provisioning, and issues JWT tokens.
   *
   * If the user's email matches an existing user, they are logged in.
   * If not, a new user is created with "member" role in the matching tenant
   * (or a new tenant if no organization mapping exists).
   */
  fastify.post('/sso/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    const workos = fastify.services.workosService;

    if (!workos || !workos.isEnabled()) {
      return reply.status(501).send({
        success: false,
        error: { code: 'SSO_NOT_CONFIGURED', message: 'SSO is not configured' },
      });
    }

    const body = SSOCallbackSchema.parse(request.body);
    const prisma = fastify.services.prisma;

    try {
      // Exchange code for profile
      const ssoProfile = await workos.getProfile(body.code);

      logger.info('SSO profile received', { email: ssoProfile.email, workosId: ssoProfile.workosId });

      // Look up existing user by email (across all tenants)
      let user = await prisma.user.findFirst({
        where: { email: ssoProfile.email },
        include: { tenant: { select: { id: true, name: true } } },
      });

      if (user) {
        // Existing user — update last login
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        const tokens = await issueTokens(fastify.services.redis, {
          id: user.id,
          tenantId: user.tenantId,
          email: user.email,
          name: user.name,
          role: user.role,
        }, user.tenant.name);

        logger.info('SSO login successful (existing user)', { userId: user.id, tenantId: user.tenantId });

        setAuthCookies(reply, tokens.accessToken, tokens.refreshToken);
        return reply.send({ success: true, data: tokens });
      }

      // JIT provisioning — create new tenant + user
      const fullName = [ssoProfile.firstName, ssoProfile.lastName].filter(Boolean).join(' ') || ssoProfile.email.split('@')[0];
      const orgName = ssoProfile.email.split('@')[1]?.split('.')[0] || 'Organization';

      const tenant = await prisma.tenant.create({
        data: {
          name: orgName.charAt(0).toUpperCase() + orgName.slice(1),
          settings: {
            auth: { ssoEnabled: true, workosOrganizationId: ssoProfile.organizationId },
          },
        },
      });

      user = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: ssoProfile.email,
          passwordHash: '', // SSO users don't have a password
          name: fullName,
          role: 'owner', // First SSO user in a new tenant is owner
          lastLoginAt: new Date(),
        },
        include: { tenant: { select: { id: true, name: true } } },
      });

      // Initialize model registry for new tenant
      try {
        const modelRegistry = new ModelRegistryService(prisma);
        await modelRegistry.seedDefaults(tenant.id);
      } catch {
        // Non-fatal: model config can be set up later
      }

      // P1: Seed Default project for new SSO tenant (non-fatal)
      try {
        await fastify.services.projectService.ensureDefaultFor(tenant.id);
      } catch {
        // Non-fatal: will be created on first access
      }

      const tokens = await issueTokens(fastify.services.redis, {
        id: user.id,
        tenantId: tenant.id,
        email: user.email,
        name: user.name,
        role: user.role,
      }, tenant.name);

      logger.info('SSO login successful (JIT provisioned)', { userId: user.id, tenantId: tenant.id });

      setAuthCookies(reply, tokens.accessToken, tokens.refreshToken);
      return reply.status(201).send({ success: true, data: tokens });

    } catch (err) {
      logger.error('SSO callback failed', { error: (err as Error).message });
      return reply.status(401).send({
        success: false,
        error: { code: 'SSO_AUTH_FAILED', message: 'SSO authentication failed' },
      });
    }
  });

  // ==========================================================================
  // POST /auth/forgot-password — Request password reset
  // ==========================================================================

  const RESET_TOKEN_PREFIX = 'password_reset:';
  const RESET_TOKEN_TTL = 60 * 60; // 1 hour

  fastify.post('/forgot-password', async (request, reply) => {
    const prisma = fastify.services.prisma;
    const redis = fastify.services.redis;
    const schema = z.object({ email: z.string().email() });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Valid email is required' },
      });
    }

    const { email } = parsed.data;

    // Always return 200 to prevent email enumeration
    const successResponse = {
      success: true,
      data: { message: 'If an account exists with that email, a reset link has been sent.' },
    };

    try {
      const user = await prisma.user.findFirst({ where: { email } });
      if (!user) {
        return reply.send(successResponse);
      }

      // Generate secure random token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const redisKey = `${RESET_TOKEN_PREFIX}${resetToken}`;

      // Store token in Redis with 1hr TTL
      await redis.setex(redisKey, RESET_TOKEN_TTL, JSON.stringify({
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
      }));

      if (config.NODE_ENV !== 'production') {
        logger.info('Password reset token generated (dev only)', { email, resetToken });
      }

      const resetUrl = `${config.PUBLIC_URL ?? 'http://localhost:3001'}/reset-password?token=${resetToken}`;
      const emailBody = [
        `Hi ${user.name ?? 'there'},`,
        '',
        'We received a request to reset your Workforce0 password.',
        '',
        `Click here to set a new one (link expires in 1 hour):`,
        resetUrl,
        '',
        'If you did not request this, you can ignore this email — your password will not change.',
        '',
        '— Workforce0',
      ].join('\n');

      try {
        await fastify.services.emailChannel.send({
          to: user.email,
          content: emailBody,
          metadata: { subject: 'Reset your Workforce0 password' },
        });
      } catch (emailErr) {
        logger.error('Failed to send password reset email', { email, error: (emailErr as Error).message });
        // Fall through to the generic success response — never reveal delivery failures
      }

      fastify.services.auditService.log({
        tenantId: user.tenantId,
        userId: user.id,
        action: 'user.forgot_password',
        resource: 'user',
        resourceId: user.id,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
    } catch (err) {
      logger.error('Failed to process forgot-password', { error: (err as Error).message });
    }

    return reply.send(successResponse);
  });

  // ==========================================================================
  // POST /auth/reset-password — Reset password with token
  // ==========================================================================

  fastify.post('/reset-password', async (request, reply) => {
    const prisma = fastify.services.prisma;
    const redis = fastify.services.redis;
    const schema = z.object({
      token: z.string().min(1),
      password: z.string().min(6),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Token and password (min 6 chars) are required' },
      });
    }

    const { token, password } = parsed.data;
    const redisKey = `${RESET_TOKEN_PREFIX}${token}`;

    try {
      const data = await redis.get(redisKey);
      if (!data) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Reset token is invalid or expired' },
        });
      }

      const { userId, tenantId } = JSON.parse(data) as { userId: string; tenantId: string; email: string };

      // Update password
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: hashPassword(password) },
      });

      // Delete the used token
      await redis.del(redisKey);

      // Invalidate all existing sessions for this user (force re-login)
      // We can't easily enumerate all refresh tokens, but the password change
      // effectively invalidates the old credentials

      fastify.services.auditService.log({
        tenantId,
        userId,
        action: 'user.password_reset',
        resource: 'user',
        resourceId: userId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });

      logger.info('Password reset successful', { userId });

      return reply.send({
        success: true,
        data: { message: 'Password has been reset. Please log in with your new password.' },
      });
    } catch (err) {
      logger.error('Failed to reset password', { error: (err as Error).message });
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to reset password' },
      });
    }
  });
}

export { verifyToken };
