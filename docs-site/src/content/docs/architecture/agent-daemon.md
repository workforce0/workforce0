---
title: Agent daemon
description: The local process that runs dev / QA tickets using your Claude Code / Cursor CLI.
---

## Why local

Dev and QA tickets produce code. The sensible choices for "who runs
the code-gen":

- **A. API call** from the backend to Anthropic / OpenAI. Simple,
  but doubles your AI bill (you already pay Claude Code / Cursor)
  and ships the repo context to a third party.
- **B. Self-hosted code model** (e.g. DeepSeek Coder on your GPU).
  Quality gap vs frontier models.
- **C. Local CLI invocation** of Claude Code / Cursor / equivalent.
  Uses your existing subscription. Production source code never
  transits anywhere beyond the CLI's call.

We chose C. The agent daemon is the process that connects the
backend's queue to your local CLI.

## Where it runs

- **Your developer laptop** — most common. One daemon per laptop.
- **A dedicated dev server** — for teams with a shared build host.
- **In-cluster as a container** — supported but unusual; only makes
  sense if the cluster has your CLI pre-installed, which most don't.

Never run the agent daemon on the same machine as the backend in
production-facing deployments — it would mean production source code
+ production data on the same host. Air-gap them.

## How it connects

1. Agent daemon reads its config (agent token, backend URL).
2. Opens a WebSocket to `wss://backend/api/agents/ws`.
3. On connect, registers its capabilities:
   - Claimable roles (`dev`, `qa` typically).
   - Repo paths it can reach (`/home/user/projects/acme-app`).
   - Active CLI subscription (`claude-code`, `cursor`, `windsurf`).
4. Starts listening for ticket assignment messages.

The agent token is minted from the web UI (**Settings → Agents →
Create token**). Revocable.

## Ticket flow

```
Backend has a dev_agent ticket for repo acme/app
  │
  ▼
Backend picks an agent that registered "repo acme/app + role dev"
  │
  ▼ (WebSocket: "claim this ticket")
Agent daemon:
  - Downloads the ticket payload (title, description, skills list,
    subagent prompt if any)
  - Assembles a CLI command: `claude -p "<prompt>" --cwd=/repo/acme-app`
  - Runs the CLI
  - Captures stdout, exit code, any diff produced
  │
  ▼ (WebSocket: "here's the result")
Backend updates the ticket → done (or failed)
  │
  ▼
Chief-of-staff watches; next steps proceed.
```

## Config

Agent daemon's `.env`:

```bash
WORKFORCE0_API_URL=https://workforce0.yourdomain.com
WORKFORCE0_AGENT_TOKEN=wfa_...
REPO_PATHS=/home/dev/projects/acme-app,/home/dev/projects/acme-mobile
CLI_COMMAND=claude        # or `cursor`, or `windsurf`, …
CLI_ARGS_TEMPLATE="--cwd {cwd} -p {prompt}"
```

## Security

- The daemon's token scopes it to a single tenant.
- The daemon refuses jobs outside `REPO_PATHS`.
- The daemon never transmits source code upstream. Ticket prompts
  go to the CLI (which may call its own cloud service — your
  existing trust), and the diff comes back to the backend.

## Multiple agents

Run multiple daemons against one backend. Load distribution is based
on:

- Which agents match the ticket's required repo.
- Which agents match the ticket's role.
- Round-robin among remaining matches.

## Offline mode

If the daemon's CLI has an offline or cached mode, the agent uses it
when network is unavailable. Otherwise tickets stay in-progress
until the daemon re-connects.

## Failures

Common failure modes:

- **CLI timeout** — daemon kills after `TICKET_TIMEOUT_DEV_SECONDS`;
  ticket → failed with "timeout".
- **CLI non-zero exit** — ticket → failed with the CLI's error.
- **Subscription quota exceeded** — daemon reports capability
  downgrade; backend routes to another agent or waits.
- **Network drop** — daemon reconnects with exponential backoff;
  claimed tickets remain claimed until BullMQ's stalled-job timeout
  (30 s), then are re-dispatched.

## Running the daemon

### From source

```bash
cd agent
npm install
WORKFORCE0_AGENT_TOKEN=... WORKFORCE0_API_URL=... npm run start
```

### In Docker

```bash
docker run -d --name wf0-agent \
  -e WORKFORCE0_API_URL=https://workforce0.example.com \
  -e WORKFORCE0_AGENT_TOKEN=wfa_... \
  -v /home/dev/projects:/repos:ro \
  -e REPO_PATHS=/repos/acme-app \
  workforce0/agent:latest
```

Note: Docker mode is awkward if your CLI lives outside the container.
Most developers run the daemon bare-metal on their laptop.

### As a launchd / systemd unit

See `agent/contrib/` for `launchd` plist, `systemd` unit, and Windows
Service templates.

## The WebSocket protocol

Messages are JSON with a `type` field:

- `agent.register` — on connect.
- `agent.heartbeat` — every 10 s.
- `ticket.assigned` — backend → daemon.
- `ticket.claim` — daemon → backend (acknowledgement).
- `ticket.progress` — daemon → backend (optional, for long jobs).
- `ticket.result` — daemon → backend (on done).
- `ticket.fail` — daemon → backend (on error).

Protocol lives in `agent/src/protocol.ts` and mirrors
`backend/src/types/agent-protocol.ts`.

## Visibility

The web UI's **Agent Jobs** page shows:

- Connected agents.
- Active jobs per agent.
- Recent results (success / failure / duration).

## Debug

```bash
LOG_LEVEL=debug WORKFORCE0_API_URL=... ./agent/bin/agent
```

Debug logs show full WS traffic. Useful for protocol mismatches
after a version skew.
