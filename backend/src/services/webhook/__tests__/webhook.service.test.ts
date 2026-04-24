import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhookService, WEBHOOK_EVENTS } from '../webhook.service.js';

// ─── Mock Prisma ─────────────────────────────────────────────────────────────

const mockPrisma = {
  webhookEndpoint: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  webhookDelivery: {
    create: vi.fn(),
  },
};

let service: WebhookService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new WebhookService(mockPrisma);
});

// ─── Static Methods ──────────────────────────────────────────────────────────

describe('WebhookService static', () => {
  it('generateSecret returns whsec_ prefixed string', () => {
    const secret = WebhookService.generateSecret();
    expect(secret).toMatch(/^whsec_[a-f0-9]{48}$/);
  });

  it('sign produces a hex HMAC-SHA256', () => {
    const sig = WebhookService.sign('payload', 'secret');
    expect(sig).toHaveLength(64); // SHA-256 = 32 bytes = 64 hex chars
  });

  it('sign is deterministic', () => {
    const a = WebhookService.sign('data', 'key');
    const b = WebhookService.sign('data', 'key');
    expect(a).toBe(b);
  });

  it('sign differs with different secrets', () => {
    const a = WebhookService.sign('data', 'key1');
    const b = WebhookService.sign('data', 'key2');
    expect(a).not.toBe(b);
  });
});

// ─── WEBHOOK_EVENTS ──────────────────────────────────────────────────────────

describe('WEBHOOK_EVENTS', () => {
  it('contains expected event types', () => {
    expect(WEBHOOK_EVENTS).toContain('meeting.completed');
    expect(WEBHOOK_EVENTS).toContain('prd.generated');
    expect(WEBHOOK_EVENTS).toContain('prd.approved');
    expect(WEBHOOK_EVENTS).toContain('tickets.created');
  });
});

// ─── CRUD ────────────────────────────────────────────────────────────────────

describe('create', () => {
  it('creates an endpoint with auto-generated secret', async () => {
    mockPrisma.webhookEndpoint.create.mockResolvedValue({
      id: 'ep-1', url: 'https://example.com/hook', events: ['meeting.completed'],
      active: true, description: null, createdAt: new Date(),
    });

    const result = await service.create('tenant-1', {
      url: 'https://example.com/hook',
      events: ['meeting.completed'],
    });

    expect(mockPrisma.webhookEndpoint.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          url: 'https://example.com/hook',
          events: ['meeting.completed'],
          secret: expect.stringMatching(/^whsec_/),
          active: true,
        }),
      })
    );
    expect(result.id).toBe('ep-1');
  });
});

describe('list', () => {
  it('returns endpoints for tenant', async () => {
    mockPrisma.webhookEndpoint.findMany.mockResolvedValue([
      { id: 'ep-1', url: 'https://a.com', events: ['meeting.completed'], active: true },
    ]);

    const result = await service.list('tenant-1');
    expect(result).toHaveLength(1);
    expect(mockPrisma.webhookEndpoint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-1' } })
    );
  });
});

describe('get', () => {
  it('returns endpoint with deliveries', async () => {
    mockPrisma.webhookEndpoint.findFirst.mockResolvedValue({
      id: 'ep-1', url: 'https://a.com', events: ['meeting.completed'], active: true,
      deliveries: [{ id: 'del-1', event: 'meeting.completed', success: true }],
    });

    const result = await service.get('tenant-1', 'ep-1');
    expect(result?.deliveries).toHaveLength(1);
  });

  it('returns null for non-existent endpoint', async () => {
    mockPrisma.webhookEndpoint.findFirst.mockResolvedValue(null);
    const result = await service.get('tenant-1', 'ep-999');
    expect(result).toBeNull();
  });
});

describe('update', () => {
  it('updates fields and verifies ownership', async () => {
    mockPrisma.webhookEndpoint.findFirst.mockResolvedValue({ id: 'ep-1', tenantId: 'tenant-1' });
    mockPrisma.webhookEndpoint.update.mockResolvedValue({
      id: 'ep-1', url: 'https://new.com', events: ['prd.generated'], active: false,
    });

    const result = await service.update('tenant-1', 'ep-1', {
      url: 'https://new.com',
      events: ['prd.generated'],
      active: false,
    });

    expect(result?.url).toBe('https://new.com');
    expect(mockPrisma.webhookEndpoint.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ep-1' },
        data: expect.objectContaining({
          url: 'https://new.com',
          events: ['prd.generated'],
          active: false,
        }),
      })
    );
  });

  it('returns null if not owned by tenant', async () => {
    mockPrisma.webhookEndpoint.findFirst.mockResolvedValue(null);
    const result = await service.update('tenant-1', 'ep-999', { active: false });
    expect(result).toBeNull();
    expect(mockPrisma.webhookEndpoint.update).not.toHaveBeenCalled();
  });
});

describe('delete', () => {
  it('deletes owned endpoint', async () => {
    mockPrisma.webhookEndpoint.findFirst.mockResolvedValue({ id: 'ep-1', tenantId: 'tenant-1' });
    mockPrisma.webhookEndpoint.delete.mockResolvedValue({});

    const result = await service.delete('tenant-1', 'ep-1');
    expect(result).toBe(true);
  });

  it('returns false for non-existent endpoint', async () => {
    mockPrisma.webhookEndpoint.findFirst.mockResolvedValue(null);
    const result = await service.delete('tenant-1', 'ep-999');
    expect(result).toBe(false);
  });
});

describe('getSecret', () => {
  it('returns secret for owned endpoint', async () => {
    mockPrisma.webhookEndpoint.findFirst.mockResolvedValue({ secret: 'whsec_abc123' });
    const result = await service.getSecret('tenant-1', 'ep-1');
    expect(result).toBe('whsec_abc123');
  });

  it('returns null for non-existent endpoint', async () => {
    mockPrisma.webhookEndpoint.findFirst.mockResolvedValue(null);
    const result = await service.getSecret('tenant-1', 'ep-999');
    expect(result).toBeNull();
  });
});

// ─── Delivery ────────────────────────────────────────────────────────────────

describe('deliver', () => {
  it('does nothing when no matching endpoints', async () => {
    mockPrisma.webhookEndpoint.findMany.mockResolvedValue([]);
    await service.deliver('tenant-1', 'meeting.completed', { id: '123' });
    expect(mockPrisma.webhookDelivery.create).not.toHaveBeenCalled();
  });

  it('delivers to matching endpoints and logs result', async () => {
    mockPrisma.webhookEndpoint.findMany.mockResolvedValue([
      { id: 'ep-1', url: 'https://httpbin.org/post', secret: 'whsec_test' },
    ]);

    // Mock fetch globally
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve('ok'),
    });
    vi.stubGlobal('fetch', mockFetch);

    await service.deliver('tenant-1', 'meeting.completed', { meetingId: '123' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://httpbin.org/post',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Webhook-Signature': expect.any(String),
        }),
      })
    );

    expect(mockPrisma.webhookDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        endpointId: 'ep-1',
        event: 'meeting.completed',
        success: true,
        statusCode: 200,
      }),
    });

    vi.unstubAllGlobals();
  });

  it('logs failure when fetch throws', async () => {
    mockPrisma.webhookEndpoint.findMany.mockResolvedValue([
      { id: 'ep-1', url: 'https://unreachable.invalid', secret: 'whsec_test' },
    ]);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));

    await service.deliver('tenant-1', 'meeting.completed', { meetingId: '123' });

    expect(mockPrisma.webhookDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        endpointId: 'ep-1',
        success: false,
        error: 'Connection refused',
      }),
    });

    vi.unstubAllGlobals();
  });

  it('never throws even when everything fails', async () => {
    mockPrisma.webhookEndpoint.findMany.mockRejectedValue(new Error('DB down'));
    // Should not throw
    await expect(service.deliver('tenant-1', 'meeting.completed', {})).resolves.toBeUndefined();
  });
});
