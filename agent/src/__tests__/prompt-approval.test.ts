import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../index.js', () => ({ log: vi.fn() }));
vi.mock('ws', () => ({ default: vi.fn(), WebSocket: vi.fn() }));
vi.mock('../executor.js', () => ({ executeJob: vi.fn() }));

const { promptApproval, __resetApprovalChainForTests } = await import('../client.js');

describe('promptApproval (stdin serialization)', () => {
  // Capture stdin.once listeners and stderr writes
  let dataListeners: Array<(buf: Buffer) => void> = [];
  let stderrWrites: string[] = [];
  let originalIsTTY: unknown;
  let originalSetRawMode: unknown;
  let originalResume: unknown;
  let originalPause: unknown;
  let onceSpy: any;
  let writeSpy: any;

  beforeEach(() => {
    __resetApprovalChainForTests();
    dataListeners = [];
    stderrWrites = [];

    // Force TTY path
    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    // Stub raw-mode / flow controls so they don't touch the real terminal
    originalSetRawMode = process.stdin.setRawMode;
    originalResume = process.stdin.resume;
    originalPause = process.stdin.pause;
    process.stdin.setRawMode = vi.fn() as unknown as typeof process.stdin.setRawMode;
    process.stdin.resume = vi.fn() as unknown as typeof process.stdin.resume;
    process.stdin.pause = vi.fn() as unknown as typeof process.stdin.pause;

    onceSpy = vi.spyOn(process.stdin, 'once').mockImplementation(((event: string, fn: unknown) => {
      if (event === 'data') dataListeners.push(fn as (buf: Buffer) => void);
      return process.stdin;
    }) as never);

    writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      stderrWrites.push(String(chunk));
      return true;
    }) as never);
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
    process.stdin.setRawMode = originalSetRawMode as typeof process.stdin.setRawMode;
    process.stdin.resume = originalResume as typeof process.stdin.resume;
    process.stdin.pause = originalPause as typeof process.stdin.pause;
    onceSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it('does not share a single keystroke across concurrent approvals', async () => {
    const promiseA = promptApproval('BANNER_A');
    const promiseB = promptApproval('BANNER_B');

    // Only A's task should be active — B is waiting on the chain.
    await Promise.resolve();
    expect(dataListeners).toHaveLength(1);
    expect(stderrWrites).toEqual(['BANNER_A']);

    // One keystroke only resolves A.
    dataListeners[0]!(Buffer.from('y\n'));
    await expect(promiseA).resolves.toBe(true);

    // Now B's task runs — banner written, new listener registered.
    await Promise.resolve();
    await Promise.resolve();
    expect(dataListeners).toHaveLength(2);
    expect(stderrWrites).toEqual(['BANNER_A', 'BANNER_B']);

    // B resolves on its own keystroke.
    dataListeners[1]!(Buffer.from('n\n'));
    await expect(promiseB).resolves.toBe(false);
  });

  it('auto-approves when stdin is not a TTY (non-interactive)', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    const result = await promptApproval('BANNER');
    expect(result).toBe(true);
    expect(stderrWrites).toEqual([]);
    expect(dataListeners).toEqual([]);
  });
});
