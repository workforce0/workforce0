# workforce0-agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight npm package (~300 lines) that connects to the Workforce0 WebSocket hub, receives coding jobs, executes them via the user's local `claude` CLI, and reports results back.

**Architecture:** Four-file TypeScript package: CLI entry point parses args, client manages WebSocket lifecycle (auth, heartbeat, reconnect), executor spawns `claude` via process spawning and captures results, git module handles push + PR creation. One runtime dependency (ws).

**Tech Stack:** TypeScript, ws, Node.js built-ins (process spawning, crypto, fs, path)

**Spec:** `docs/superpowers/specs/2026-03-20-workforce0-agent-design.md`

---

## File Structure

```
agent/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # CLI entry point: arg parsing, token resolution, starts client
│   ├── client.ts             # WebSocket client: connect, auth, heartbeat, reconnect
│   ├── executor.ts           # Job executor: spawns claude CLI, parses output, reports progress
│   ├── git.ts                # Git operations: branch, push, PR creation via gh CLI
│   └── __tests__/
│       ├── client.test.ts
│       ├── executor.test.ts
│       └── git.test.ts
└── README.md
```

---

## Task 1: Package Scaffold + CLI Entry Point

**Files:**
- Create: `agent/package.json`
- Create: `agent/tsconfig.json`
- Create: `agent/src/index.ts`

- [ ] **Step 1: Create package.json with ws dependency, tsx/vitest devDeps, bin entry point**
- [ ] **Step 2: Create tsconfig.json targeting ES2022, NodeNext modules**
- [ ] **Step 3: Create src/index.ts with arg parsing (--token, --repos, --server, --max-jobs, --job-timeout, --verbose, --version), token resolution (CLI > env WF0_TOKEN > ~/.workforce0/token file), repo validation, structured JSON logging to stderr, and graceful shutdown handlers**
- [ ] **Step 4: Run `cd agent && npm install`**
- [ ] **Step 5: Verify `cd agent && npx tsc --noEmit` has no errors in index.ts**
- [ ] **Step 6: Commit: `feat: scaffold workforce0-agent package with CLI entry point`**

See spec for full CLI arg table and token resolution priority.

---

## Task 2: WebSocket Client

**Files:**
- Create: `agent/src/client.ts`
- Test: `agent/src/__tests__/client.test.ts`

- [ ] **Step 1: Write failing tests** — auth flow (auth_ok, auth_error), register on auth success, heartbeat ping/pong, job message handling (ack immediately, track in activeJobs), server_shutdown handling (drain mode, delayed reconnect), job_complete handling (remove from activeJobs), reconnect with exponential backoff, shutdown waits for active jobs
- [ ] **Step 2: Run tests, verify fail**
- [ ] **Step 3: Implement AgentClient class** — constructor takes AgentConfig, `start()` opens WebSocket, `handleMessage()` switches on type, `connect()` with event handlers, `scheduleReconnect()` with doubling delay (1s-30s max), `shutdown()` drains active jobs (60s timeout), `send()` wraps in try-catch, `detectCapabilities()` checks for claude/git/npm/gh, all logging via structured JSON to stderr
- [ ] **Step 4: Run tests, verify pass**
- [ ] **Step 5: Commit: `feat: add WebSocket client with auth, heartbeat, reconnect, and job routing`**

---

## Task 3: Job Executor

**Files:**
- Create: `agent/src/executor.ts`
- Test: `agent/src/__tests__/executor.test.ts`

- [ ] **Step 1: Write failing tests** — execute('implement_prd') spawns claude with correct args, prompt piped via stdin (not CLI arg), uses --output-format json, validates payload (branch regex /^[a-zA-Z0-9._\/-]+$/, prdContent required and < 500KB), invalid payload returns failure without spawning, timeout kills process, exit 0 calls git.pushAndCreatePR, exit non-zero returns failure, claude not installed returns clear error
- [ ] **Step 2: Run tests, verify fail**
- [ ] **Step 3: Implement JobExecutor class** — constructor takes AgentConfig + onProgress callback, `execute(action, payload)` validates then spawns, `buildPrompt(action, payload)` constructs prompt per action type (implement_prd tells Claude to NOT push/PR, review_pr reviews branch), `runClaude(prompt, cwd)` spawns process with stdin piping and timeout, `validatePayload()` checks branch name and content size, post-claude git operations for implement_prd action
- [ ] **Step 4: Run tests, verify pass**
- [ ] **Step 5: Commit: `feat: add job executor with claude CLI spawning, validation, and output parsing`**

---

## Task 4: Git Operations

**Files:**
- Create: `agent/src/git.ts`
- Test: `agent/src/__tests__/git.test.ts`

- [ ] **Step 1: Write failing tests** — prepareRepo fetches and checkouts new branch (main fallback to master), pushAndCreatePR pushes then runs gh pr create, returns PR URL from gh output, retries push once on failure, returns null if gh not available, detectRemoteUrl returns origin URL, hasUnpushedCommits checks log
- [ ] **Step 2: Run tests, verify fail**
- [ ] **Step 3: Implement git functions** — all use promisified execFile (array args, no shell injection), prepareRepo tries origin/main then origin/master, pushAndCreatePR retries push once after 3s, creates PR via gh CLI if available, detectRemoteUrl and hasUnpushedCommits as utilities
- [ ] **Step 4: Run tests, verify pass**
- [ ] **Step 5: Commit: `feat: add git operations with push retry and gh PR creation`**

---

## Task 5: Integration — Wire Everything + Manual Test

**Files:**
- Verify all imports work
- Create: `agent/README.md`

- [ ] **Step 1: Verify full build: `cd agent && npx tsc --noEmit` — zero errors**
- [ ] **Step 2: Run all tests: `cd agent && npx vitest run` — all pass**
- [ ] **Step 3: Create README.md** with quick start (export WF0_TOKEN, npx workforce0-agent --repos), requirements (Node 20+, claude CLI, git, optional gh), full options table
- [ ] **Step 4: Manual test against local hub** — create agent token via API, start agent with --verbose pointing to ws://localhost:8005/agent/ws, verify connection in hub logs, check agent status via GET /api/agents/status
- [ ] **Step 5: Commit: `feat: complete workforce0-agent package with README`**
