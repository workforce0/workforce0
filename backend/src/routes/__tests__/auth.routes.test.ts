/**
 * Unit tests for Auth Routes
 *
 * Tests:
 * - POST /auth/signup: success, duplicate email, validation errors
 * - POST /auth/login: success (legacy + User model), wrong password, unknown email
 * - POST /auth/refresh: valid, invalid, expired
 * - POST /auth/logout: success
 * - GET /auth/me: valid token, missing token, invalid token, tenant not found
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';

vi.mock('../../lib/logger.js', () => {
  const childLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
    }),
  };
  return {
    createChildLogger: vi.fn().mockReturnValue(childLogger),
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnValue(childLogger) },
  };
});

vi.mock('../../config/index.js', () => ({
  config: {
    JWT_SECRET: 'test-jwt-secret-that-is-long-enough-32chars',
  },
}));

import { authRoutes, verifyToken } from '../auth.routes.js';

// --- Mock helpers ---

function createMockRedis() {
  const store: Record<string, string> = {};
  return {
    setex: vi.fn(async (key: string, _ttl: number, val: string) => { store[key] = val; }),
    get: vi.fn(async (key: string) => store[key] || null),
    del: vi.fn(async (key: string) => { delete store[key]; }),
    _store: store,
  };
}

function createMockPrisma(overrides: Record<string, any> = {}) {
  return {
    tenant: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: any) => ({
        id: 'tenant-123',
        name: data.name,
        settings: data.settings,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      update: vi.fn().mockResolvedValue({}),
      ...overrides,
    },
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: any) => ({
        id: 'user-1',
        tenantId: data.tenantId,
        email: data.email,
        passwordHash: data.passwordHash,
        name: data.name,
        role: data.role,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      update: vi.fn().mockResolvedValue({}),
    },
    modelProvider: { upsert: vi.fn().mockResolvedValue({ id: 'provider-1' }) },
    modelConfig: { upsert: vi.fn().mockResolvedValue({ id: 'config-1' }) },
    agentConfig: { upsert: vi.fn().mockResolvedValue({ id: 'agent-config-1' }) },
    teamMember: { create: vi.fn().mockResolvedValue({ id: 'member-1' }) },
    invitation: { findUnique: vi.fn().mockResolvedValue(null) },
  };
}

async function buildApp(prisma: ReturnType<typeof createMockPrisma>, redis?: ReturnType<typeof createMockRedis>): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cookie);
  app.decorate('services', { prisma, redis: redis || createMockRedis(), auditService: { log: vi.fn() } } as any);
  await app.register(authRoutes);
  await app.ready();
  return app;
}

describe('Auth Routes', () => {
  let app: FastifyInstance;
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
    mockRedis = createMockRedis();
    app = await buildApp(mockPrisma, mockRedis);
  });

  // =========================================================================
  // POST /signup
  // =========================================================================
  describe('POST /signup', () => {
    const validBody = {
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
      organizationName: 'Test Org',
    };

    it('creates account and returns 201 with tokens', async () => {
      const res = await app.inject({ method: 'POST', url: '/signup', payload: validBody });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.token).toBeDefined();
      expect(body.data.accessToken).toBeDefined();
      expect(body.data.refreshToken).toBeDefined();
      expect(body.data.user.email).toBe('test@example.com');
      expect(body.data.user.tenantId).toBe('tenant-123');
      expect(body.data.user.role).toBe('owner');

      // User model should be created
      expect(mockPrisma.user.create).toHaveBeenCalled();
      // Refresh token stored in Redis
      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it('returns 409 when email exists in User table', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-existing' });

      const res = await app.inject({ method: 'POST', url: '/signup', payload: validBody });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('EMAIL_EXISTS');
    });

    it('returns 409 when email exists in legacy tenant settings', async () => {
      mockPrisma.tenant.findMany.mockResolvedValue([{ id: 'existing' }]);

      const res = await app.inject({ method: 'POST', url: '/signup', payload: validBody });
      expect(res.statusCode).toBe(409);
    });

    it('returns error for invalid email', async () => {
      const res = await app.inject({
        method: 'POST', url: '/signup',
        payload: { ...validBody, email: 'not-an-email' },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('returns error for short password', async () => {
      const res = await app.inject({
        method: 'POST', url: '/signup',
        payload: { ...validBody, password: '123' },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('returned token is valid JWT with expected claims', async () => {
      const res = await app.inject({ method: 'POST', url: '/signup', payload: validBody });
      const { token } = res.json().data;
      const payload = verifyToken(token);
      expect(payload).not.toBeNull();
      expect(payload!.tenantId).toBe('tenant-123');
      expect(payload!.email).toBe('test@example.com');
      expect(payload!.role).toBe('owner');
      expect(payload!.type).toBe('access');
    });
  });

  // =========================================================================
  // POST /login
  // =========================================================================
  describe('POST /login', () => {
    const loginBody = { email: 'test@example.com', password: 'password123' };

    function makeUserWithPassword(password: string) {
      const crypto = require('crypto');
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
      return {
        id: 'user-1',
        tenantId: 'tenant-456',
        email: 'test@example.com',
        passwordHash: `${salt}:${hash}`,
        name: 'Test User',
        role: 'owner',
        tenant: { id: 'tenant-456', name: 'Test Org' },
      };
    }

    function makeLegacyTenant(password: string) {
      const crypto = require('crypto');
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
      return {
        id: 'tenant-456',
        name: 'Test Org',
        settings: { auth: { email: 'test@example.com', name: 'Test User', passwordHash: `${salt}:${hash}` } },
      };
    }

    it('returns 200 with tokens on valid credentials (User model)', async () => {
      const user = makeUserWithPassword('password123');
      mockPrisma.user.findFirst.mockResolvedValue(user);

      const res = await app.inject({ method: 'POST', url: '/login', payload: loginBody });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.data.token).toBeDefined();
      expect(body.data.accessToken).toBeDefined();
      expect(body.data.refreshToken).toBeDefined();
      expect(body.data.user.tenantId).toBe('tenant-456');
    });

    it('returns 200 via legacy tenant auth fallback', async () => {
      const tenant = makeLegacyTenant('password123');
      mockPrisma.tenant.findMany.mockResolvedValue([tenant]);
      // Auto-migration creates user
      mockPrisma.user.create.mockResolvedValue({
        id: 'migrated-user',
        tenantId: 'tenant-456',
        email: 'test@example.com',
        name: 'Test User',
        role: 'owner',
      });

      const res = await app.inject({ method: 'POST', url: '/login', payload: loginBody });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.token).toBeDefined();
    });

    it('returns 401 for wrong password', async () => {
      const user = makeUserWithPassword('correctpassword');
      mockPrisma.user.findFirst.mockResolvedValue(user);

      const res = await app.inject({
        method: 'POST', url: '/login',
        payload: { ...loginBody, password: 'wrongpassword' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
    });

    it('returns 401 for unknown email', async () => {
      const res = await app.inject({ method: 'POST', url: '/login', payload: loginBody });
      expect(res.statusCode).toBe(401);
    });

    it('returned token is valid JWT', async () => {
      const user = makeUserWithPassword('password123');
      mockPrisma.user.findFirst.mockResolvedValue(user);

      const res = await app.inject({ method: 'POST', url: '/login', payload: loginBody });
      const { token } = res.json().data;
      const payload = verifyToken(token);
      expect(payload).not.toBeNull();
      expect(payload!.tenantId).toBe('tenant-456');
    });
  });

  // =========================================================================
  // POST /refresh
  // =========================================================================
  describe('POST /refresh', () => {
    it('issues new tokens with valid refresh token', async () => {
      // Store a refresh token in Redis
      const refreshToken = 'valid-refresh-token-123';
      mockRedis._store[`refresh_token:${refreshToken}`] = JSON.stringify({ userId: 'user-1', tenantId: 'tenant-1' });

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        tenantId: 'tenant-1',
        email: 'test@example.com',
        name: 'Test User',
        role: 'admin',
        tenant: { id: 'tenant-1', name: 'Test Org' },
      });

      const res = await app.inject({
        method: 'POST', url: '/refresh',
        payload: { refreshToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.accessToken).toBeDefined();
      expect(body.data.refreshToken).toBeDefined();
      // Old refresh token should be revoked
      expect(mockRedis.del).toHaveBeenCalledWith(`refresh_token:${refreshToken}`);
    });

    it('returns 401 for invalid refresh token', async () => {
      const res = await app.inject({
        method: 'POST', url: '/refresh',
        payload: { refreshToken: 'invalid-token' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('INVALID_REFRESH_TOKEN');
    });
  });

  // =========================================================================
  // POST /logout
  // =========================================================================
  describe('POST /logout', () => {
    it('revokes refresh token', async () => {
      const res = await app.inject({
        method: 'POST', url: '/logout',
        payload: { refreshToken: 'some-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith('refresh_token:some-token');
    });
  });

  // =========================================================================
  // GET /me
  // =========================================================================
  describe('GET /me', () => {
    async function getValidToken() {
      const res = await app.inject({
        method: 'POST', url: '/signup',
        payload: { email: 'me@example.com', password: 'password123', name: 'Me User', organizationName: 'Me Org' },
      });
      return res.json().data.token;
    }

    it('returns user data with valid token', async () => {
      const token = await getValidToken();
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-123',
        name: 'Me Org',
        settings: { auth: { email: 'me@example.com', name: 'Me User' } },
      });
      // /auth/me also reads the user row for hasSeenTour (PR #63).
      // Mock it explicitly so the 401 user-not-found guard doesn't fire.
      mockPrisma.user.findUnique.mockResolvedValue({
        hasSeenTour: false,
      });

      const res = await app.inject({
        method: 'GET', url: '/me',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.email).toBe('me@example.com');
      expect(body.data.name).toBe('Me User');
      expect(body.data.organizationName).toBe('Me Org');
      expect(body.data.hasSeenTour).toBe(false);
    });

    it('returns 401 when user row no longer exists (deleted account)', async () => {
      const token = await getValidToken();
      mockPrisma.tenant.findUnique.mockResolvedValue({
        id: 'tenant-123',
        name: 'Me Org',
        settings: {},
      });
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET', url: '/me',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error?.code).toBe('USER_NOT_FOUND');
    });

    it('returns 401 when no authorization header', async () => {
      const res = await app.inject({ method: 'GET', url: '/me' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 with invalid token', async () => {
      const res = await app.inject({
        method: 'GET', url: '/me',
        headers: { authorization: 'Bearer invalid.token.here' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 404 when tenant not found', async () => {
      const token = await getValidToken();
      mockPrisma.tenant.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET', url: '/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
