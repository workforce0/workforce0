/**
 * =============================================================================
 * SSE Service — Tests
 * =============================================================================
 *
 * Tests:
 *   - addClient sends initial connected event
 *   - publish sends event to connected clients for that tenant
 *   - publish does nothing for unconnected tenants
 *   - Client disconnect removes from client list
 *   - getClientCount returns correct count
 *   - getTotalClientCount across tenants
 *   - destroy cleans up all connections
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SSEService } from '../sse.service.js';
import { EventEmitter } from 'events';

function createMockResponse() {
  const emitter = new EventEmitter();
  const res = {
    writeHead: vi.fn(),
    write: vi.fn().mockReturnValue(true),
    end: vi.fn(),
    writableEnded: false,
    on: (event: string, cb: () => void) => emitter.on(event, cb),
    _emitter: emitter,
  };
  return res;
}

describe('SSEService', () => {
  let service: SSEService;

  beforeEach(() => {
    service = new SSEService();
  });

  afterEach(() => {
    service.destroy();
  });

  it('addClient sets SSE headers and sends connected event', () => {
    const res = createMockResponse();

    service.addClient('tenant-1', res as any);

    expect(res.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Should have sent the connected event
    expect(res.write).toHaveBeenCalledTimes(1);
    const written = res.write.mock.calls[0][0] as string;
    expect(written).toContain('event: connected');
    expect(written).toContain('"message":"SSE connection established"');
  });

  it('publish sends event to all connected clients for a tenant', () => {
    const res1 = createMockResponse();
    const res2 = createMockResponse();

    service.addClient('tenant-1', res1 as any);
    service.addClient('tenant-1', res2 as any);

    service.publish('tenant-1', 'engagement.phase_changed', { id: 'e-1', phase: 'build' });

    // Each client: 1 connected event + 1 published event = 2 writes
    expect(res1.write).toHaveBeenCalledTimes(2);
    expect(res2.write).toHaveBeenCalledTimes(2);

    const eventStr = res1.write.mock.calls[1][0] as string;
    expect(eventStr).toContain('event: engagement.phase_changed');
    expect(eventStr).toContain('"phase":"build"');
  });

  it('publish does nothing for unconnected tenants', () => {
    const res = createMockResponse();
    service.addClient('tenant-1', res as any);

    // Publish to a different tenant
    service.publish('tenant-2', 'notification.new', { message: 'hello' });

    // Only the connected event, no published event
    expect(res.write).toHaveBeenCalledTimes(1);
  });

  it('does not send to other tenants', () => {
    const res1 = createMockResponse();
    const res2 = createMockResponse();

    service.addClient('tenant-1', res1 as any);
    service.addClient('tenant-2', res2 as any);

    service.publish('tenant-1', 'agent.status_changed', { agentType: 'ba_agent', status: 'running' });

    // tenant-1: connected + event = 2
    // tenant-2: connected only = 1
    expect(res1.write).toHaveBeenCalledTimes(2);
    expect(res2.write).toHaveBeenCalledTimes(1);
  });

  it('removes client on disconnect', () => {
    const res = createMockResponse();

    service.addClient('tenant-1', res as any);
    expect(service.getClientCount('tenant-1')).toBe(1);

    // Simulate disconnect
    res._emitter.emit('close');

    expect(service.getClientCount('tenant-1')).toBe(0);
  });

  it('getClientCount returns correct count', () => {
    const res1 = createMockResponse();
    const res2 = createMockResponse();

    expect(service.getClientCount('tenant-1')).toBe(0);

    service.addClient('tenant-1', res1 as any);
    expect(service.getClientCount('tenant-1')).toBe(1);

    service.addClient('tenant-1', res2 as any);
    expect(service.getClientCount('tenant-1')).toBe(2);
  });

  it('getTotalClientCount sums across tenants', () => {
    const res1 = createMockResponse();
    const res2 = createMockResponse();
    const res3 = createMockResponse();

    service.addClient('tenant-1', res1 as any);
    service.addClient('tenant-2', res2 as any);
    service.addClient('tenant-2', res3 as any);

    expect(service.getTotalClientCount()).toBe(3);
  });

  it('destroy ends all connections and clears client list', () => {
    const res1 = createMockResponse();
    const res2 = createMockResponse();

    service.addClient('tenant-1', res1 as any);
    service.addClient('tenant-2', res2 as any);

    service.destroy();

    expect(res1.end).toHaveBeenCalled();
    expect(res2.end).toHaveBeenCalled();
    expect(service.getTotalClientCount()).toBe(0);
  });

  it('publish includes event id', () => {
    const res = createMockResponse();
    service.addClient('tenant-1', res as any);

    service.publish('tenant-1', 'test.event', { foo: 'bar' });

    const eventStr = res.write.mock.calls[1][0] as string;
    expect(eventStr).toMatch(/^id: \d+-[a-z0-9]+\n/);
  });
});
