# workforce0-agent — Lightweight CLI Daemon

**Date:** 2026-03-20
**Status:** Approved
**Sub-project:** 2 of 4 (Agent Architecture Rebuild)

## Overview

A tiny Node.js daemon (~300 lines) that users install on their machine. Connects to the Workforce0 WebSocket hub, receives jobs (implement PRD, review PR, run tests), executes them using the user's locally-installed `claude` CLI, and reports results back.

```bash
npx workforce0-agent --token wf0_abc123 --repos acme/backend:/home/dev/myapp
```

## Package Structure

```
workforce0-agent/
├── src/
│   ├── index.ts          # CLI entry point (arg parsing, starts client)
│   ├── client.ts         # WebSocket client (connect, auth, heartbeat, reconnect)
│   ├── executor.ts       # Job executor (spawns claude CLI, captures output)
│   └── git.ts            # Git operations (checkout branch, push, detect remote)
├── package.json
├── tsconfig.json
└── README.md
```

Lives at `workspace-root/agent/` — separate from the `mvp/` backend. Published as `workforce0-agent` on npm.

## CLI Arguments

| Arg | Required | Default | Description |
|-----|----------|---------|-------------|
| `--token <wf0_xxx>` | Yes* | — | Agent token (also: `WF0_TOKEN` env var) |
| `--repos <slug>:<path>[,...]` | Yes | — | Repo slug-to-local-path mapping |
| `--server <url>` | No | `wss://api.workforce0.dev/agent/ws` | Server URL (also: `WF0_SERVER` env var) |
| `--max-jobs <n>` | No | 3 | Max concurrent jobs |
| `--job-timeout <min>` | No | 45 | Job timeout in minutes |
| `--verbose` | No | false | Debug logging |
| `--version` | No | — | Print version and exit |

*Token can also be read from `WF0_TOKEN` env var or `~/.workforce0/token` file (avoids exposure in `ps aux`).

Priority: CLI arg > env var > token file.

Example:
```bash
# Option A: CLI arg (visible in ps)
npx workforce0-agent \
  --token wf0_a1b2c3d4 \
  --repos acme/backend:/home/dev/backend

# Option B: Env var (recommended)
WF0_TOKEN=wf0_a1b2c3d4 npx workforce0-agent \
  --repos acme/backend:/home/dev/backend

# Option C: Token file (persistent)
echo "wf0_a1b2c3d4" > ~/.workforce0/token
npx workforce0-agent --repos acme/backend:/home/dev/backend
```

## Logging

Structured JSON to stderr (so stdout stays clean for piping):

```
{"level":"info","msg":"Connected as agent cuid123","tenantId":"tenant-1","time":"..."}
{"level":"info","msg":"Registered 2 repos, waiting for jobs...","repos":["acme/backend","acme/frontend"]}
{"level":"info","msg":"Job received","jobId":"job-1","action":"implement_prd"}
{"level":"info","msg":"Job completed","jobId":"job-1","status":"done","duration":"12m34s"}
{"level":"error","msg":"Claude process failed","jobId":"job-1","exitCode":1}
```

`--verbose` flag enables debug-level output (WebSocket frames, heartbeats, git commands).

## WebSocket Client Protocol

Follows the protocol defined in the WebSocket Hub spec.

### Connection Flow

```
Start
  ↓
Connect WebSocket to server URL (no token in URL)
  ↓
Send { type: "auth", token: "wf0_xxx" }
  ↓
Receive { type: "auth_ok", agentId, tenantId }
  → Log "Connected as agent {agentId} for tenant {tenantId}"
  ↓
Send { type: "register", repos: [...slugs], capabilities: [...] }
  ↓
Receive { type: "registered", repos: 2 }
  → Log "Registered 2 repos, waiting for jobs..."
  ↓
Start heartbeat: send { type: "ping" } every 30 seconds
  ↓
Listen for incoming messages (job, server_shutdown, job_complete)
```

### Job Handling

```
Receive { type: "job", jobId, action, payload }
  ↓
Send { type: "job_ack", jobId } immediately (wrapped in try-catch — reconnect on send failure)
  ↓
Cache job locally: activeJobs.set(jobId, { action, payload })
  ↓
Resolve targetRepo slug to local path
  ↓
Spawn executor for the job action
  ↓
Periodically send { type: "job_progress", jobId, message, percent }
  ↓
On completion: send { type: "job_result", jobId, status: "done"|"failed", data }
  ↓
Receive { type: "job_complete", jobId } → remove from activeJobs cache, log completion
```

### Server Shutdown Handling

On `{ type: "server_shutdown", reconnectAfter: N }`:
1. Stop accepting new jobs (set `draining = true`)
2. Wait for in-flight jobs to complete (up to 60s)
3. Delay reconnection by `reconnectAfter` seconds (instead of normal backoff)
4. Then reconnect normally

### Reconnection

- On disconnect: exponential backoff (1s, 2s, 4s, 8s, max 30s)
- On reconnect: re-auth + re-register
- In-progress jobs from previous connection will timeout on the hub side (1 hour) and be marked failed. The agent does NOT attempt to resume — it starts fresh on reconnect. (The hub generates a new agentId per connection, so job_resume is not supported in v1.)
- If auth fails on reconnect: log error, stop retrying (token likely revoked)

### Shutdown

On SIGINT/SIGTERM:
1. Stop accepting new jobs
2. Wait for current jobs to finish (up to 60s timeout)
3. Send close frame and disconnect

## Job Executor

### Supported Actions

| Action | What it does |
|--------|-------------|
| implement_prd | Reads PRD, spawns claude to write code + tests, pushes branch, creates PR |
| review_pr | Reads PR diff, spawns claude to review, reports findings |
| run_tests | Runs test suite in repo, reports results |

### Claude CLI Invocation

Uses `child_process.spawn` with array args (no shell). **Prompt is piped via stdin** to avoid OS argument length limits (PRDs can be very large):

```typescript
const proc = spawn('claude', [
  '-p', '-',                    // Read prompt from stdin
  '--output-format', 'json',   // Structured output for reliable parsing
  '--allowedTools', 'Edit,Write,Bash,Read,Grep,Glob',
], {
  cwd: repoPath,
  env: { ...process.env },   // Inherits user's Claude auth
});

proc.stdin.write(prompt);
proc.stdin.end();

// 45 minute timeout (configurable via --job-timeout)
setTimeout(() => proc.kill('SIGTERM'), jobTimeoutMs);
```

### Prompt Construction

**Key design:** Claude only writes code and commits locally. The agent's `git.ts` handles push and PR creation deterministically. This separates creative work (Claude) from mechanical work (agent).

For implement_prd:
```
You are implementing a feature for the {repoSlug} repository.

Read this PRD and implement it following the project's existing conventions.
Write production code and tests. Create a new git branch named "{payload.branch}"
and commit your work. Do NOT push or create a PR — that will be handled separately.

PRD:
{payload.prdContent}
```

For review_pr:
```
Review the code changes on branch "{payload.branch}" in the current repository.
Check against these requirements, look for bugs, security issues, and test coverage gaps.

Requirements:
{payload.prdContent}
```

### Payload Validation

Before executing, the agent validates:
- `payload.branch`: must match `/^[a-zA-Z0-9._\/-]+$/` (no special chars)
- `payload.prdContent` or `payload.prompt`: must be present and < 500KB
- `targetRepo`: must map to a known repo slug in the --repos config

Invalid payloads result in immediate `job_result` failed without spawning claude.

### Output Parsing

Uses `--output-format json` for structured output. Falls back to regex if JSON parsing fails:
- PR URLs: regex matching github.com or gitlab.com PR/MR URLs
- Test results: "X passed, Y failed" patterns
- Exit code: 0 = done, non-zero = failed
- Truncated output (killed process) = always failed

### Post-Claude Git Operations

After claude exits successfully (code 0):
1. `git.ts` verifies there are commits on the branch
2. `git.ts` pushes the branch: `git push -u origin {branch}`
3. `git.ts` creates PR via `gh pr create` (if `gh` CLI available)
4. Agent reports `job_result` with PR URL (or just branch name if no `gh`)

This split means git failures are handled deterministically with retries, not buried inside Claude's opaque Bash tool.

### Error Handling

| Error | Behavior |
|-------|----------|
| claude not installed | job_result failed, error: "claude CLI not found" |
| claude crashes mid-job | Capture stderr, send job_result failed |
| Timeout (45 min default) | Kill process, send job_result failed with "timeout" |
| Git push fails | Retry once after 3s. If still fails, include git error in job_result |
| Repo path not found | job_result failed with "repo not found at path" |
| Invalid payload | job_result failed with validation error, claude not spawned |
| ws.send() fails | Trigger reconnection, job result will be lost (hub times out after 1hr) |

## Git Operations

The git.ts module uses execFile (not shell) for all git commands:

```typescript
async function prepareRepo(repoPath: string, branch: string): Promise<void> {
  // execFile('git', ['fetch', 'origin'], { cwd: repoPath })
  // execFile('git', ['checkout', '-b', branch, 'origin/main'], { cwd: repoPath })
}

async function pushAndCreatePR(repoPath: string, branch: string, title: string): Promise<string | null> {
  // execFile('git', ['push', '-u', 'origin', branch], { cwd: repoPath })
  // execFile('gh', ['pr', 'create', '--title', title, '--body', '...'], { cwd: repoPath })
  // Return PR URL or null
}
```

## Capabilities Detection

On startup, the agent checks what tools are available:

```typescript
function detectCapabilities(): string[] {
  const caps: string[] = [];
  if (commandExists('claude')) caps.push('claude');
  if (commandExists('git')) caps.push('git');
  if (commandExists('npm')) caps.push('npm');
  if (commandExists('gh')) caps.push('gh');
  return caps;
}
```

Reported in the register message. Hub uses this for job routing.

## Dependencies

Minimal:
```json
{
  "dependencies": {
    "ws": "^8.18.0"
  }
}
```

One dependency. Everything else uses Node.js built-ins.

## What This Sub-Project Does NOT Include

- WebSocket Hub changes (sub-project 1, done)
- Rewiring Dev/QA agents to dispatch jobs (sub-project 3)
- Settings UI for agent setup (sub-project 4)
- Auto-update mechanism (future)
- Windows support (future, Linux/macOS first)

## Testing Strategy

### Unit Tests
- client.ts: Mock WebSocket, test auth flow, reconnect logic, heartbeat
- executor.ts: Mock spawn, test prompt construction, output parsing, timeout
- git.ts: Mock execFile, test branch creation, push, PR URL detection

### Manual Testing
- Start hub locally (npm run dev in mvp/)
- Create an agent token via API
- Run agent pointing to local server
- Dispatch a job and verify the full cycle
