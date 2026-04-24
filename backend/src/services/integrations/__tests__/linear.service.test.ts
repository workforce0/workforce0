import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LinearService } from '../linear.service.js';

// We stub fetch for every test. No live Linear calls.
const originalFetch = globalThis.fetch;

function mockGql(data: unknown, { status = 200 }: { status?: number } = {}) {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ data }), { status, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

function mockErrors(errors: Array<{ message: string }>) {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ errors }), { status: 200, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

describe('LinearService', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('isConfigured', () => {
    it('is false when no config', () => {
      expect(new LinearService(null).isConfigured()).toBe(false);
    });

    it('is false when key has wrong prefix', () => {
      expect(new LinearService({ apiKey: 'xyz-bad' }).isConfigured()).toBe(false);
    });

    it('is true when key starts with lin_api_', () => {
      expect(new LinearService({ apiKey: 'lin_api_abc' }).isConfigured()).toBe(true);
    });
  });

  describe('test()', () => {
    it('returns NOT_CONFIGURED without a config', async () => {
      const result = await new LinearService(null).test();
      expect(result).toMatchObject({ ok: false, code: 'NOT_CONFIGURED' });
    });

    it('returns INVALID_KEY_FORMAT when prefix wrong', async () => {
      const result = await new LinearService({ apiKey: 'oops' }).test();
      expect(result).toMatchObject({ ok: false, code: 'INVALID_KEY_FORMAT' });
    });

    it('returns ok with viewer when Linear responds', async () => {
      mockGql({ viewer: { id: 'user-1', name: 'Jane', email: 'jane@acme.com' } });
      const result = await new LinearService({ apiKey: 'lin_api_test' }).test();
      expect(result.ok).toBe(true);
      expect(result.viewer?.email).toBe('jane@acme.com');
      expect(result.message).toContain('Jane');
    });

    it('returns INVALID_AUTH on auth error', async () => {
      mockErrors([{ message: 'Authentication failed' }]);
      const result = await new LinearService({ apiKey: 'lin_api_test' }).test();
      expect(result).toMatchObject({ ok: false, code: 'INVALID_AUTH' });
    });
  });

  describe('listTeams()', () => {
    it('throws when not configured', async () => {
      const svc = new LinearService(null);
      await expect(svc.listTeams()).rejects.toThrow(/not connected/);
    });

    it('returns the teams array', async () => {
      mockGql({ teams: { nodes: [{ id: 't1', name: 'Engineering', key: 'ENG' }] } });
      const svc = new LinearService({ apiKey: 'lin_api_test' });
      const teams = await svc.listTeams();
      expect(teams).toHaveLength(1);
      expect(teams[0]!.key).toBe('ENG');
    });
  });

  describe('resolveUserByEmail()', () => {
    it('returns null when email is blank', async () => {
      const svc = new LinearService({ apiKey: 'lin_api_test' });
      expect(await svc.resolveUserByEmail('')).toBeNull();
    });

    it('returns the first matching active user', async () => {
      mockGql({
        users: {
          nodes: [{ id: 'u-1', name: 'David', email: 'david@acme.com', active: true }],
        },
      });
      const svc = new LinearService({ apiKey: 'lin_api_test' });
      const user = await svc.resolveUserByEmail('david@acme.com');
      expect(user?.id).toBe('u-1');
    });

    it('returns null when no user matches', async () => {
      mockGql({ users: { nodes: [] } });
      const svc = new LinearService({ apiKey: 'lin_api_test' });
      expect(await svc.resolveUserByEmail('nobody@acme.com')).toBeNull();
    });
  });

  describe('createIssue()', () => {
    it('throws without a team', async () => {
      const svc = new LinearService({ apiKey: 'lin_api_test' });
      await expect(svc.createIssue({ title: 't' })).rejects.toThrow(/No Linear team selected/);
    });

    it('uses defaultTeamId when teamId not passed', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              issueCreate: {
                success: true,
                issue: { id: 'i-1', identifier: 'ENG-1', title: 't', url: 'https://linear.app/x', state: { name: 'Todo' } },
              },
            },
          }),
          { status: 200 },
        ),
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const svc = new LinearService({ apiKey: 'lin_api_test', defaultTeamId: 't-default' });
      const issue = await svc.createIssue({ title: 'Ship it' });
      expect(issue.identifier).toBe('ENG-1');

      const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
      expect(body.variables.input.teamId).toBe('t-default');
    });

    it('sends the API key WITHOUT the Bearer prefix (Linear quirk)', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              issueCreate: {
                success: true,
                issue: { id: 'i-1', identifier: 'ENG-1', title: 't', url: 'https://x', state: { name: 'Todo' } },
              },
            },
          }),
          { status: 200 },
        ),
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const svc = new LinearService({ apiKey: 'lin_api_abc', defaultTeamId: 't-1' });
      await svc.createIssue({ title: 't' });

      const headers = fetchSpy.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(headers.Authorization).toBe('lin_api_abc');
      expect(headers.Authorization).not.toMatch(/^Bearer /);
    });

    it('throws AppError when Linear returns success=false', async () => {
      mockGql({ issueCreate: { success: false, issue: null } });
      const svc = new LinearService({ apiKey: 'lin_api_test', defaultTeamId: 't-1' });
      await expect(svc.createIssue({ title: 't' })).rejects.toThrow(/LINEAR_CREATE_FAILED|issueCreate\.success/);
    });
  });

  describe('priorityFromPrd', () => {
    it.each([
      ['critical', 1],
      ['urgent', 1],
      ['high', 2],
      ['medium', 3],
      ['low', 4],
      ['', 0],
      [undefined, 0],
      ['unknown', 0],
    ] as const)('%s → %d', (input, expected) => {
      expect(LinearService.priorityFromPrd(input as string | undefined)).toBe(expected);
    });
  });
});
