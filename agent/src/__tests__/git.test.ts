import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We mock the entire 'node:child_process' module so execFile is injectable
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

// We also mock 'node:util' so that promisify returns the mocked execFile wrapper
vi.mock('node:util', () => ({
  promisify: vi.fn((fn: unknown) => fn),
}));

import * as childProcess from 'node:child_process';
import {
  prepareRepo,
  pushAndCreatePR,
  detectRemoteUrl,
  hasUnpushedCommits,
} from '../git.js';

// Helper: cast to vitest mock
const mockExecFile = childProcess.execFile as unknown as ReturnType<typeof vi.fn>;

// execFile mock signature expected by promisify wrapping:
// execFile(cmd, args, callback) — but since promisify returns fn as-is in our mock,
// our implementation calls execFile(cmd, args) and we return a promise.
// So we make execFile return a promise directly (the promisified version).

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// prepareRepo
// ---------------------------------------------------------------------------

describe('prepareRepo', () => {
  it('calls git fetch then git checkout from origin/main', async () => {
    mockExecFile
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // git fetch
      .mockResolvedValueOnce({ stdout: '', stderr: '' }); // git checkout -b branch origin/main

    await prepareRepo('/repo', 'feature-branch');

    expect(mockExecFile).toHaveBeenCalledTimes(2);

    const [cmd1, args1] = mockExecFile.mock.calls[0] as [string, string[]];
    expect(cmd1).toBe('git');
    expect(args1).toEqual(['fetch', 'origin']);

    const [cmd2, args2] = mockExecFile.mock.calls[1] as [string, string[]];
    expect(cmd2).toBe('git');
    expect(args2).toEqual(['-C', '/repo', 'checkout', '-b', 'feature-branch', 'origin/main']);
  });

  it('falls back to origin/master if origin/main checkout fails', async () => {
    mockExecFile
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // git fetch
      .mockRejectedValueOnce(new Error('pathspec origin/main did not match')) // checkout origin/main fails
      .mockResolvedValueOnce({ stdout: '', stderr: '' }); // checkout origin/master succeeds

    await prepareRepo('/repo', 'feature-branch');

    expect(mockExecFile).toHaveBeenCalledTimes(3);

    const [cmd3, args3] = mockExecFile.mock.calls[2] as [string, string[]];
    expect(cmd3).toBe('git');
    expect(args3).toEqual(['-C', '/repo', 'checkout', '-b', 'feature-branch', 'origin/master']);
  });

  it('propagates error when both origin/main and origin/master fail', async () => {
    mockExecFile
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // git fetch
      .mockRejectedValueOnce(new Error('no origin/main'))  // checkout origin/main fails
      .mockRejectedValueOnce(new Error('no origin/master')); // checkout origin/master fails

    await expect(prepareRepo('/repo', 'feature-branch')).rejects.toThrow('no origin/master');
  });
});

// ---------------------------------------------------------------------------
// pushAndCreatePR
// ---------------------------------------------------------------------------

describe('pushAndCreatePR', () => {
  it('pushes branch then creates PR and returns URL', async () => {
    mockExecFile
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // git push
      .mockResolvedValueOnce({ stdout: 'https://github.com/org/repo/pull/42\n', stderr: '' }); // gh pr create

    const url = await pushAndCreatePR('/repo', 'feature-branch', 'My PR Title');

    expect(url).toBe('https://github.com/org/repo/pull/42');

    const [cmd1, args1] = mockExecFile.mock.calls[0] as [string, string[]];
    expect(cmd1).toBe('git');
    expect(args1).toEqual(['-C', '/repo', 'push', '-u', 'origin', 'feature-branch']);

    const [cmd2, args2] = mockExecFile.mock.calls[1] as [string, string[]];
    expect(cmd2).toBe('gh');
    expect(args2).toContain('pr');
    expect(args2).toContain('create');
    expect(args2).toContain('My PR Title');
    expect(args2).toContain('feature-branch');
  });

  it('retries push once on failure then succeeds', async () => {
    mockExecFile
      .mockRejectedValueOnce(new Error('push failed'))      // first push attempt
      .mockResolvedValueOnce({ stdout: '', stderr: '' })     // retry push
      .mockResolvedValueOnce({ stdout: 'https://github.com/org/repo/pull/7\n', stderr: '' }); // gh pr

    const url = await pushAndCreatePR('/repo', 'feature-branch', 'Title');

    expect(url).toBe('https://github.com/org/repo/pull/7');

    // Two git push calls + one gh pr create
    const calls = mockExecFile.mock.calls as [string, string[]][];
    const pushCalls = calls.filter(([cmd, args]) => cmd === 'git' && args.includes('push'));
    expect(pushCalls).toHaveLength(2);
  });

  it('returns null if gh CLI is not available', async () => {
    mockExecFile
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // git push succeeds
      .mockRejectedValueOnce(new Error('gh: command not found')); // gh pr create fails

    const url = await pushAndCreatePR('/repo', 'feature-branch', 'Title');

    expect(url).toBeNull();
  });

  it('returns null if push fails twice (exhausts retries)', async () => {
    mockExecFile
      .mockRejectedValueOnce(new Error('push failed'))  // first push
      .mockRejectedValueOnce(new Error('push failed')); // retry push

    const url = await pushAndCreatePR('/repo', 'feature-branch', 'Title');

    expect(url).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectRemoteUrl
// ---------------------------------------------------------------------------

describe('detectRemoteUrl', () => {
  it('returns trimmed stdout from git remote get-url origin', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: 'https://github.com/org/repo.git\n',
      stderr: '',
    });

    const url = await detectRemoteUrl('/repo');

    expect(url).toBe('https://github.com/org/repo.git');

    const [cmd, args] = mockExecFile.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('git');
    expect(args).toEqual(['-C', '/repo', 'remote', 'get-url', 'origin']);
  });
});

// ---------------------------------------------------------------------------
// hasUnpushedCommits
// ---------------------------------------------------------------------------

describe('hasUnpushedCommits', () => {
  it('returns true when git log output is non-empty', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: 'abc1234 my commit message\n',
      stderr: '',
    });

    const result = await hasUnpushedCommits('/repo', 'feature-branch');

    expect(result).toBe(true);

    const [cmd, args] = mockExecFile.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('git');
    expect(args).toEqual(['-C', '/repo', 'log', 'origin/main..feature-branch', '--oneline']);
  });

  it('returns false when git log output is empty', async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await hasUnpushedCommits('/repo', 'feature-branch');

    expect(result).toBe(false);
  });
});
