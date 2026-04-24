# workforce0-agent

Lightweight daemon that connects to Workforce0 and executes AI coding jobs using your local Claude CLI.

## Quick Start

```bash
# Set your token (from Workforce0 Settings > Agent Tokens)
export WF0_TOKEN=wf0_your_token_here

# Start the agent
npx workforce0-agent --repos acme/backend:/path/to/your/repo
```

## Requirements

- Node.js 20+
- Claude CLI installed and authenticated (`claude --version`)
- Git installed
- (Optional) GitHub CLI for automatic PR creation (`gh --version`)

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--token` | `WF0_TOKEN` env / `~/.workforce0/token` | Agent token |
| `--repos` | required | `slug:/path` mapping (comma-separated) |
| `--server` | `wss://your-workforce0-host/api/agents/ws` | Hub URL |
| `--max-jobs` | 3 | Concurrent job limit |
| `--job-timeout` | 45 | Minutes before killing a job |
| `--verbose` | false | Debug logging |
| `--version` | — | Print version and exit |

## How It Works

1. Agent connects to Workforce0 hub via WebSocket
2. Authenticates with your token and registers available repos
3. Receives jobs when PRDs are approved (implement feature, review PR, run tests)
4. Spawns `claude` CLI to do the AI work using your local subscription
5. Pushes code and creates PRs via git/gh
6. Reports results back to the hub for the web UI

## Token Sources (priority order)

1. `--token` CLI argument
2. `WF0_TOKEN` environment variable
3. `~/.workforce0/token` file
