import { spawn } from 'node:child_process';
import type { AgentConfig } from './index.js';
import { log } from './index.js';
import { pushAndCreatePR } from './git.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BRANCH_RE = /^[a-zA-Z0-9._\/-]+$/;
const MAX_PRD_BYTES = 500 * 1024; // 500 KB

const CLAUDE_ARGS = [
  '-p',
  '-',
  '--output-format',
  'json',
  '--allowedTools',
  'Edit,Write,Bash,Read,Grep,Glob',
];

// ---------------------------------------------------------------------------
// Progress patterns to scan from claude stdout
// ---------------------------------------------------------------------------
const PROGRESS_PATTERNS: Array<{ re: RegExp; percent: number; label: string }> = [
  { re: /reading|loading|opening/i, percent: 5, label: 'Reading PRD...' },
  { re: /analyzing|understanding|exploring/i, percent: 15, label: 'Analyzing requirements...' },
  { re: /planning|designing|thinking/i, percent: 20, label: 'Planning implementation...' },
  { re: /creating|writing|generating/i, percent: 30, label: 'Writing code...' },
  { re: /editing|modifying|updating/i, percent: 45, label: 'Writing code...' },
  { re: /test|spec|assert/i, percent: 60, label: 'Writing tests...' },
  { re: /running|executing/i, percent: 65, label: 'Running tasks...' },
  { re: /committing|git commit/i, percent: 80, label: 'Committing...' },
  { re: /pushing|git push/i, percent: 90, label: 'Pushing to remote...' },
  { re: /done|complete|finished/i, percent: 95, label: 'Finalizing...' },
];

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ExecuteResult {
  success: boolean;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildPrompt(action: string, payload: Record<string, unknown>): string {
  switch (action) {
    case 'implement_prd': {
      const branch = payload.branch as string;
      const prdContent = payload.prdContent as string;
      return [
        `You are an expert software engineer. Your task is to implement the following Product Requirements Document (PRD).`,
        ``,
        `Target branch: ${branch}`,
        ``,
        `## PRD`,
        ``,
        prdContent,
        ``,
        `## Instructions`,
        ``,
        `1. Read the existing codebase to understand its structure and conventions.`,
        `2. Implement all features described in the PRD.`,
        `3. Create a git branch named "${branch}" if it does not already exist.`,
        `4. Commit all your changes with a descriptive commit message.`,
        ``,
        `IMPORTANT: Do NOT push the branch or create a pull request — just implement, commit, and stop.`,
      ].join('\n');
    }

    case 'review_pr': {
      const branch = (payload.branch as string | undefined) ?? 'HEAD';
      return [
        `You are a senior code reviewer. Please review the changes on branch "${branch}".`,
        ``,
        `1. Use git diff or git log to inspect the changes.`,
        `2. Check for bugs, security issues, style violations, and missing tests.`,
        `3. Provide a structured review with clear, actionable feedback.`,
      ].join('\n');
    }

    case 'run_tests': {
      return [
        `You are a QA engineer. Please run the test suite for this project.`,
        ``,
        `1. Identify the test runner and configuration (package.json, Makefile, etc.).`,
        `2. Run all tests using the appropriate command.`,
        `3. Report pass/fail counts, and summarize any failures with their root causes.`,
      ].join('\n');
    }

    default: {
      return (payload.prompt as string | undefined) ?? `Perform the action: ${action}`;
    }
  }
}

// ---------------------------------------------------------------------------
// JobExecutor
// ---------------------------------------------------------------------------

export class JobExecutor {
  constructor(
    private config: AgentConfig,
    private onProgress: (message: string, percent: number, logs?: string[]) => void,
  ) {}

  async execute(action: string, payload: Record<string, unknown>): Promise<ExecuteResult> {
    // ------------------------------------------------------------------
    // 1. Validate targetRepo
    // ------------------------------------------------------------------
    const targetRepo = payload.targetRepo as string | undefined;
    if (!targetRepo || !this.config.repos.has(targetRepo)) {
      return {
        success: false,
        data: { error: `Unknown targetRepo: "${targetRepo ?? ''}". Not in configured repos.` },
      };
    }

    const repoPath = this.config.repos.get(targetRepo)!;

    // ------------------------------------------------------------------
    // 2. Action-specific validation
    // ------------------------------------------------------------------
    if (action === 'implement_prd') {
      const branch = payload.branch as string | undefined;
      if (!branch || !BRANCH_RE.test(branch)) {
        return {
          success: false,
          data: {
            error: `Invalid branch name: "${branch ?? ''}". Must match [a-zA-Z0-9._/-]+`,
          },
        };
      }

      const prdContent = payload.prdContent as string | undefined;
      if (!prdContent) {
        return {
          success: false,
          data: { error: 'prdContent is required for implement_prd action.' },
        };
      }
      if (Buffer.byteLength(prdContent, 'utf8') > MAX_PRD_BYTES) {
        return {
          success: false,
          data: { error: `prdContent exceeds maximum size of ${MAX_PRD_BYTES} bytes (500 KB).` },
        };
      }
    }

    // ------------------------------------------------------------------
    // 3. Build prompt
    // ------------------------------------------------------------------
    const prompt = buildPrompt(action, payload);

    // ------------------------------------------------------------------
    // 4. Spawn claude
    // ------------------------------------------------------------------
    this.onProgress('Reading PRD...', 5);
    log('info', 'Spawning claude', { action, repoPath });

    return new Promise<ExecuteResult>((resolve) => {
      let stdoutBuf = '';
      let stderrBuf = '';
      let spawnError: Error | null = null;
      let timedOut = false;
      let settled = false;

      const settle = (result: ExecuteResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const proc = spawn('claude', CLAUDE_ARGS, {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // ------------------------------------------------------------------
      // Timeout
      // ------------------------------------------------------------------
      const timeoutMs = this.config.jobTimeoutMin * 60 * 1000;
      const timer = setTimeout(() => {
        timedOut = true;
        clearInterval(logFlushInterval);
        log('warn', 'Job timed out — killing claude process', { action });
        proc.kill('SIGTERM');
        settle({
          success: false,
          data: { error: `Job timeout: exceeded ${this.config.jobTimeoutMin} minute(s).` },
        });
      }, timeoutMs);

      // ------------------------------------------------------------------
      // Write prompt to stdin then close
      // ------------------------------------------------------------------
      proc.stdin.write(prompt);
      proc.stdin.end();

      // ------------------------------------------------------------------
      // Capture output + buffer log lines for streaming
      // ------------------------------------------------------------------
      let lineBuffer: string[] = [];
      let lastProgressLabel = 'Working...';
      let lastProgressPercent = 0;

      proc.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdoutBuf += text;

        // Buffer individual lines for log streaming
        const newLines = text.split('\n').filter(Boolean);
        lineBuffer.push(...newLines);

        // Scan for progress patterns
        for (const { re, percent, label } of PROGRESS_PATTERNS) {
          if (re.test(text)) {
            lastProgressLabel = label;
            lastProgressPercent = percent;
            break;
          }
        }
      });

      // Flush buffered log lines every 3 seconds
      const logFlushInterval = setInterval(() => {
        if (lineBuffer.length > 0) {
          this.onProgress(lastProgressLabel, lastProgressPercent, lineBuffer);
          lineBuffer = [];
        }
      }, 3000);

      proc.stderr.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString();
      });

      // ------------------------------------------------------------------
      // Handle spawn errors (e.g. ENOENT — claude not installed)
      // ------------------------------------------------------------------
      proc.on('error', (err: NodeJS.ErrnoException) => {
        spawnError = err;
        log('error', 'claude spawn error', { code: err.code, message: err.message });
      });

      // ------------------------------------------------------------------
      // Handle close
      // ------------------------------------------------------------------
      proc.on('close', async (exitCode: number | null) => {
        clearInterval(logFlushInterval);

        // Flush any remaining buffered lines
        if (lineBuffer.length > 0) {
          this.onProgress(lastProgressLabel, lastProgressPercent, lineBuffer);
          lineBuffer = [];
        }

        if (timedOut) {
          // Already settled via timeout handler
          return;
        }

        if (spawnError) {
          const errMsg =
            (spawnError as NodeJS.ErrnoException).code === 'ENOENT'
              ? 'claude CLI not found. Please install it: npm install -g @anthropic-ai/claude-cli'
              : `Failed to spawn claude: ${spawnError.message}`;
          settle({ success: false, data: { error: errMsg } });
          return;
        }

        const code = exitCode ?? 1;

        if (code !== 0) {
          settle({
            success: false,
            data: {
              exitCode: code,
              stderr: stderrBuf,
              stdout: stdoutBuf,
            },
          });
          return;
        }

        // ------------------------------------------------------------------
        // Exit 0 — success
        // ------------------------------------------------------------------
        this.onProgress('Completed successfully', 100);
        log('info', 'claude exited successfully', { action });

        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(stdoutBuf) as Record<string, unknown>;
        } catch {
          // stdout may not be pure JSON — keep it as-is
          parsed = { raw: stdoutBuf };
        }

        // ------------------------------------------------------------------
        // Post-execution: push + PR for implement_prd
        // ------------------------------------------------------------------
        if (action === 'implement_prd') {
          const branch = payload.branch as string;
          const title = (payload.title as string | undefined) ?? `feat: ${branch}`;

          this.onProgress('Pushing branch and creating PR...', 97);

          try {
            const prUrl = await pushAndCreatePR(repoPath, branch, title);
            parsed.prUrl = prUrl;
          } catch (err) {
            log('warn', 'pushAndCreatePR failed (non-fatal)', {
              error: (err as Error).message,
            });
          }
        }

        settle({ success: true, data: parsed });
      });
    });
  }
}
