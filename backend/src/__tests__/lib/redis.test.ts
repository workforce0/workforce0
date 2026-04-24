/**
 * =============================================================================
 * Redis Connection Factory — Tests
 * =============================================================================
 *
 * Tests parseSentinelHosts parsing and createRedisConnection config selection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ioredis', () => {
  class MockRedisClass {
    static _calls: any[] = [];
    constructor(...args: any[]) {
      MockRedisClass._calls.push(args);
    }
    on() { return this; }
  }
  return { default: MockRedisClass, Redis: MockRedisClass };
});

import { parseSentinelHosts, createRedisConnection } from '../../lib/redis.js';
import { Redis } from 'ioredis';

const MockRedis = Redis as any;

describe('Redis Factory', () => {
  beforeEach(() => {
    MockRedis._calls = [];
  });

  // =========================================================================
  // parseSentinelHosts()
  // =========================================================================
  describe('parseSentinelHosts()', () => {
    it('parses a single host:port', () => {
      expect(parseSentinelHosts('sentinel1:26379')).toEqual([
        { host: 'sentinel1', port: 26379 },
      ]);
    });

    it('parses multiple comma-separated hosts', () => {
      expect(parseSentinelHosts('s1:26379,s2:26380,s3:26381')).toEqual([
        { host: 's1', port: 26379 },
        { host: 's2', port: 26380 },
        { host: 's3', port: 26381 },
      ]);
    });

    it('defaults port to 26379 when not specified', () => {
      expect(parseSentinelHosts('sentinel1')).toEqual([
        { host: 'sentinel1', port: 26379 },
      ]);
    });

    it('handles whitespace around entries', () => {
      expect(parseSentinelHosts(' s1:26379 , s2:26380 ')).toEqual([
        { host: 's1', port: 26379 },
        { host: 's2', port: 26380 },
      ]);
    });

    it('filters out empty entries', () => {
      expect(parseSentinelHosts('s1:26379,,s2:26380,')).toEqual([
        { host: 's1', port: 26379 },
        { host: 's2', port: 26380 },
      ]);
    });
  });

  // =========================================================================
  // createRedisConnection()
  // =========================================================================
  describe('createRedisConnection()', () => {
    it('creates standalone connection when no sentinel config', () => {
      const cfg = {
        REDIS_URL: 'redis://localhost:6379',
        REDIS_SENTINEL_HOSTS: undefined,
        REDIS_SENTINEL_MASTER: undefined,
      } as any;

      createRedisConnection(cfg, { name: 'test-standalone' });

      expect(MockRedis._calls).toHaveLength(1);
      expect(MockRedis._calls[0][0]).toBe('redis://localhost:6379');
      expect(MockRedis._calls[0][1]).toMatchObject({
        maxRetriesPerRequest: 3,
      });
    });

    it('creates sentinel connection when REDIS_SENTINEL_HOSTS is set', () => {
      const cfg = {
        REDIS_URL: 'redis://localhost:6379',
        REDIS_SENTINEL_HOSTS: 'sentinel1:26379,sentinel2:26380',
        REDIS_SENTINEL_MASTER: 'mymaster',
      } as any;

      createRedisConnection(cfg, { name: 'test-sentinel' });

      expect(MockRedis._calls).toHaveLength(1);
      const callArg = MockRedis._calls[0][0];
      expect(callArg).toMatchObject({
        sentinels: [
          { host: 'sentinel1', port: 26379 },
          { host: 'sentinel2', port: 26380 },
        ],
        name: 'mymaster',
      });
    });

    it('defaults sentinel master to "mymaster" when not configured', () => {
      const cfg = {
        REDIS_URL: 'redis://localhost:6379',
        REDIS_SENTINEL_HOSTS: 'sentinel1:26379',
        REDIS_SENTINEL_MASTER: undefined,
      } as any;

      createRedisConnection(cfg, { name: 'test-default-master' });

      const callArg = MockRedis._calls[0][0];
      expect(callArg.name).toBe('mymaster');
    });

    it('passes maxRetriesPerRequest: null for BullMQ connections', () => {
      const cfg = {
        REDIS_URL: 'redis://localhost:6379',
        REDIS_SENTINEL_HOSTS: undefined,
        REDIS_SENTINEL_MASTER: undefined,
      } as any;

      createRedisConnection(cfg, { name: 'bullmq', maxRetriesPerRequest: null });

      expect(MockRedis._calls[0][1]).toMatchObject({
        maxRetriesPerRequest: null,
      });
    });
  });
});
