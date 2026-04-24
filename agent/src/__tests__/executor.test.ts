import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Mock node:child_process — spawn returns a controllable fake process
// ---------------------------------------------------------------------------
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

// Mock node:util so promisify passes through
vi.mock('node:util', () => ({
  promisify: vi.fn((fn: unknown) => fn),
}));

// ---------------------------------------------------------------------------
// Mock the git module
// ---------------------------------------------------------------------------
vi.mock('../git.js', () => ({
  pushAndCreatePR: vi.fn(),
}));

// Mock index.js so it doesn't auto-run main()
vi.mock('../index.js', () => ({
  log: vi.fn(),
}));

import * as childProcess from 'node:child_process';
import * as gitModule from '../git.js';
import type { AgentConfig } from '../index.js';

const mockSpawn = childProcess.spawn as unknown as ReturnType<typeof vi.fn>;
const mockPushAndCreatePR = gitModule.pushAndCreatePR as unknown as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// FakeProcess — simulates the child_process.ChildProcess returned by spawn()
// ---------------------------------------------------------------------------
class FakeProcess extends EventEmitter {
  stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;

  kill(signal?: string) {
    this.killed = true;
    this.emit('close', 1, signal ?? 'SIGTERM');
  }

  /** Helper: emit stdout data then close with given exit code */
  finishWith(exitCode: number, stdoutData = '', stderrData = '') {
    if (stdoutData) this.stdout.emit('data', Buffer.from(stdoutData));
    if (stderrData) this.stderr.emit('data', Buffer.from(stderrData));
    this.emit('close', exitCode);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    token: 'test-token',
    repos: new Map([['my-repo', '/tmp/my-repo']]),
    server: 'ws://localhost:9999',
    maxJobs: 3,
    jobTimeoutMin: 1,
    verbose: false,
    requireApproval: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Import under test (after mocks are registered)
// ---------------------------------------------------------------------------
const { JobExecutor } = await import('../executor.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('JobExecutor', () => {
  let fakeProc: FakeProcess;
  const onProgress = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    fakeProc = new FakeProcess();
    mockSpawn.mockReturnValue(fakeProc);
    mockPushAndCreatePR.mockResolvedValue('https://github.com/org/repo/pull/1');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Validation: targetRepo
  // -------------------------------------------------------------------------
  describe('targetRepo validation', () => {
    it('returns failure immediately when targetRepo is not in config.repos', async () => {
      const executor = new JobExecutor(makeConfig(), onProgress);

      const result = await executor.execute('implement_prd', {
        targetRepo: 'unknown-repo',
        branch: 'feature/test',
        prdContent: 'Build something',
      });

      expect(result.success).toBe(false);
      expect(result.data.error).toMatch(/unknown-repo/);
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Validation: implement_prd — branch name
  // -------------------------------------------------------------------------
  describe('implement_prd branch validation', () => {
    it('rejects branch names with special chars (spaces, $, etc.)', async () => {
      const executor = new JobExecutor(makeConfig(), onProgress);

      const result = await executor.execute('implement_prd', {
        targetRepo: 'my-repo',
        branch: 'bad branch name!',
        prdContent: 'Some PRD',
      });

      expect(result.success).toBe(false);
      expect(result.data.error).toMatch(/branch/i);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('rejects branch names with $ signs', async () => {
      const executor = new JobExecutor(makeConfig(), onProgress);

      const result = await executor.execute('implement_prd', {
        targetRepo: 'my-repo',
        branch: 'feature/$bad',
        prdContent: 'Some PRD',
      });

      expect(result.success).toBe(false);
      expect(result.data.error).toMatch(/branch/i);
    });

    it('accepts valid branch names', async () => {
      const executor = new JobExecutor(makeConfig(), onProgress);

      // Don't await fully — just confirm it gets past validation (spawn is called)
      const promise = executor.execute('implement_prd', {
        targetRepo: 'my-repo',
        branch: 'feature/my-task_1.0',
        prdContent: 'Some PRD content',
      });

      // Finish the fake process so the promise resolves
      fakeProc.finishWith(0, JSON.stringify({ result: 'done' }));

      const result = await promise;
      // May fail for other reasons (e.g. claude not installed) but spawn was called
      expect(mockSpawn).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Validation: implement_prd — prdContent
  // -------------------------------------------------------------------------
  describe('implement_prd prdContent validation', () => {
    it('rejects missing prdContent', async () => {
      const executor = new JobExecutor(makeConfig(), onProgress);

      const result = await executor.execute('implement_prd', {
        targetRepo: 'my-repo',
        branch: 'feature/test',
      });

      expect(result.success).toBe(false);
      expect(result.data.error).toMatch(/prdContent/i);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('rejects prdContent larger than 500KB', async () => {
      const executor = new JobExecutor(makeConfig(), onProgress);

      const bigContent = 'x'.repeat(500 * 1024 + 1);

      const result = await executor.execute('implement_prd', {
        targetRepo: 'my-repo',
        branch: 'feature/test',
        prdContent: bigContent,
      });

      expect(result.success).toBe(false);
      expect(result.data.error).toMatch(/prdContent/i);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('accepts prdContent exactly at 500KB limit', async () => {
      const executor = new JobExecutor(makeConfig(), onProgress);

      const exactContent = 'x'.repeat(500 * 1024);

      const promise = executor.execute('implement_prd', {
        targetRepo: 'my-repo',
        branch: 'feature/test',
        prdContent: exactContent,
      });

      fakeProc.finishWith(0, JSON.stringify({ result: 'done' }));

      await promise;
      expect(mockSpawn).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // spawn: correct flags
  // -------------------------------------------------------------------------
  describe('spawn arguments', () => {
    it('spawns claude with -p -, --output-format json, and --allowedTools', async () => {
      const executor = new JobExecutor(makeConfig(), onProgress);

      const promise = executor.execute('implement_prd', {
        targetRepo: 'my-repo',
        branch: 'feature/test',
        prdContent: 'Build it',
      });

      fakeProc.finishWith(0, JSON.stringify({ result: 'ok' }));

      await promise;

      expect(mockSpawn).toHaveBeenCalledOnce();
      const [cmd, args] = mockSpawn.mock.calls[0] as [string, string[]];
      expect(cmd).toBe('claude');
      expect(args).toContain('-p');
      expect(args).toContain('-');
      expect(args).toContain('--output-format');
      expect(args).toContain('json');
      expect(args).toContain('--allowedTools');
      const allowedToolsIndex = args.indexOf('--allowedTools');
      const toolsValue = args[allowedToolsIndex + 1];
      expect(toolsValue).toContain('Edit');
      expect(toolsValue).toContain('Write');
      expect(toolsValue).toContain('Bash');
      expect(toolsValue).toContain('Read');
    });
  });

  // -------------------------------------------------------------------------
  // Prompt piped via stdin
  // -------------------------------------------------------------------------
  describe('stdin prompt piping', () => {
    it('writes the prompt via stdin.write (not as a CLI arg)', async () => {
      const executor = new JobExecutor(makeConfig(), onProgress);

      const promise = executor.execute('implement_prd', {
        targetRepo: 'my-repo',
        branch: 'feature/my-feature',
        prdContent: 'Build a login page',
      });

      fakeProc.finishWith(0, JSON.stringify({ result: 'ok' }));

      await promise;

      expect(fakeProc.stdin.write).toHaveBeenCalled();
      const writtenArg = fakeProc.stdin.write.mock.calls[0][0] as string;
      // The prompt should contain the PRD content
      expect(writtenArg).toContain('Build a login page');
      // Also verify stdin.end is called after writing
      expect(fakeProc.stdin.end).toHaveBeenCalled();
    });

    it('prompt for review_pr mentions the branch', async () => {
      const executor = new JobExecutor(makeConfig(), onProgress);

      const promise = executor.execute('review_pr', {
        targetRepo: 'my-repo',
        branch: 'feature/to-review',
      });

      fakeProc.finishWith(0, JSON.stringify({ result: 'ok' }));

      await promise;

      const writtenArg = fakeProc.stdin.write.mock.calls[0][0] as string;
      expect(writtenArg).toContain('feature/to-review');
    });

    it('uses payload.prompt for unknown action types', async () => {
      const executor = new JobExecutor(makeConfig(), onProgress);

      const promise = executor.execute('custom_action', {
        targetRepo: 'my-repo',
        prompt: 'Do something custom',
      });

      fakeProc.finishWith(0, JSON.stringify({ result: 'ok' }));

      await promise;

      const writtenArg = fakeProc.stdin.write.mock.calls[0][0] as string;
      expect(writtenArg).toContain('Do something custom');
    });
  });

  // -------------------------------------------------------------------------
  // Exit code handling
  // -------------------------------------------------------------------------
  describe('exit code handling', () => {
    it('returns success=true when claude exits with code 0', async () => {
      const executor = new JobExecutor(makeConfig(), onProgress);

      const promise = executor.execute('run_tests', {
        targetRepo: 'my-repo',
      });

      fakeProc.finishWith(0, JSON.stringify({ result: 'tests passed' }));

      const result = await promise;
      expect(result.success).toBe(true);
    });

    it('returns success=false with stderr when claude exits non-zero', async () => {
      const executor = new JobExecutor(makeConfig(), onProgress);

      const promise = executor.execute('run_tests', {
        targetRepo: 'my-repo',
      });

      fakeProc.finishWith(1, '', 'Error: something broke');

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.data.stderr).toContain('Error: something broke');
    });
  });

  // -------------------------------------------------------------------------
  // pushAndCreatePR called on implement_prd success
  // -------------------------------------------------------------------------
  describe('post-execution git operations', () => {
    it('calls pushAndCreatePR on implement_prd success', async () => {
      const executor = new JobExecutor(makeConfig(), onProgress);

      const promise = executor.execute('implement_prd', {
        targetRepo: 'my-repo',
        branch: 'feature/new-thing',
        prdContent: 'Build new thing',
        title: 'New Thing PR',
      });

      fakeProc.finishWith(0, JSON.stringify({ result: 'ok' }));

      const result = await promise;

      expect(result.success).toBe(true);
      expect(mockPushAndCreatePR).toHaveBeenCalledOnce();
      const [repoPath, branch] = mockPushAndCreatePR.mock.calls[0] as [string, string, string];
      expect(repoPath).toBe('/tmp/my-repo');
      expect(branch).toBe('feature/new-thing');
    });

    it('does NOT call pushAndCreatePR on implement_prd failure', async () => {
      const executor = new JobExecutor(makeConfig(), onProgress);

      const promise = executor.execute('implement_prd', {
        targetRepo: 'my-repo',
        branch: 'feature/bad',
        prdContent: 'Something',
      });

      fakeProc.finishWith(2, '', 'compilation error');

      const result = await promise;

      expect(result.success).toBe(false);
      expect(mockPushAndCreatePR).not.toHaveBeenCalled();
    });

    it('does NOT call pushAndCreatePR for non-implement_prd actions', async () => {
      const executor = new JobExecutor(makeConfig(), onProgress);

      const promise = executor.execute('run_tests', {
        targetRepo: 'my-repo',
      });

      fakeProc.finishWith(0, JSON.stringify({ result: 'passed' }));

      await promise;

      expect(mockPushAndCreatePR).not.toHaveBeenCalled();
    });

    it('includes prUrl in result data when PR is created', async () => {
      mockPushAndCreatePR.mockResolvedValue('https://github.com/org/repo/pull/99');

      const executor = new JobExecutor(makeConfig(), onProgress);

      const promise = executor.execute('implement_prd', {
        targetRepo: 'my-repo',
        branch: 'feature/with-pr',
        prdContent: 'Do stuff',
      });

      fakeProc.finishWith(0, JSON.stringify({ result: 'ok' }));

      const result = await promise;

      expect(result.data.prUrl).toBe('https://github.com/org/repo/pull/99');
    });
  });

  // -------------------------------------------------------------------------
  // claude not installed
  // -------------------------------------------------------------------------
  describe('claude CLI not installed', () => {
    it('returns failure with a clear error message when spawn emits ENOENT', async () => {
      const errorProc = new FakeProcess();
      mockSpawn.mockReturnValue(errorProc);

      const executor = new JobExecutor(makeConfig(), onProgress);

      const promise = executor.execute('run_tests', {
        targetRepo: 'my-repo',
      });

      // Simulate "command not found" error from OS
      const err = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
      errorProc.emit('error', err);
      errorProc.emit('close', 1);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.data.error as string).toMatch(/claude/i);
    });
  });

  // -------------------------------------------------------------------------
  // Timeout
  // -------------------------------------------------------------------------
  describe('timeout', () => {
    it('kills process and returns failure when timeout expires', async () => {
      const executor = new JobExecutor(
        makeConfig({ jobTimeoutMin: 1 }),
        onProgress,
      );

      const killSpy = vi.spyOn(fakeProc, 'kill');

      const promise = executor.execute('run_tests', {
        targetRepo: 'my-repo',
      });

      // Advance time past the timeout (1 min = 60000 ms)
      await vi.advanceTimersByTimeAsync(61_000);

      // After kill, emit close so promise resolves
      // (The real kill() on FakeProcess already emits close, but spying replaces it)
      // Just emit close manually to resolve
      if (!fakeProc.killed) {
        fakeProc.emit('close', 1);
      }

      const result = await promise;

      expect(killSpy).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.data.error as string).toMatch(/timeout/i);
    });
  });
});
