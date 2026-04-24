#!/usr/bin/env node

import { resolve } from 'path';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';

export interface AgentConfig {
  token: string;
  repos: Map<string, string>;
  server: string;
  maxJobs: number;
  jobTimeoutMin: number;
  verbose: boolean;
  requireApproval: boolean;
}

export function log(level: string, msg: string, extra?: Record<string, unknown>): void {
  console.error(JSON.stringify({ level, msg, ...extra, time: new Date().toISOString() }));
}

export function parseArgs(argv: string[]): AgentConfig {
  const args = argv.slice(2);

  if (args.includes('--version')) {
    console.log('workforce0-agent v0.1.0');
    process.exit(0);
  }

  let token = '';
  let reposRaw = '';
  let server = 'wss://api.workforce0.com/agent/ws';
  let maxJobs = 3;
  let jobTimeoutMin = 45;
  let verbose = args.includes('--verbose');
  let requireApproval = args.includes('--require-approval');

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--token': token = args[++i] || ''; break;
      case '--repos': reposRaw = args[++i] || ''; break;
      case '--server': server = args[++i] || server; break;
      case '--max-jobs': maxJobs = parseInt(args[++i] || '3', 10); break;
      case '--job-timeout': jobTimeoutMin = parseInt(args[++i] || '45', 10); break;
    }
  }

  // Token: CLI > env > file
  if (!token) token = process.env.WF0_TOKEN || '';
  if (!token) {
    const tokenFile = resolve(homedir(), '.workforce0', 'token');
    if (existsSync(tokenFile)) {
      token = readFileSync(tokenFile, 'utf-8').trim();
    }
  }
  if (!token) {
    console.error('Error: --token, WF0_TOKEN env var, or ~/.workforce0/token required');
    process.exit(1);
  }

  // Server from env
  if (!args.includes('--server') && process.env.WF0_SERVER) {
    server = process.env.WF0_SERVER;
  }

  // Parse repos
  if (!reposRaw) {
    console.error('Error: --repos required (format: slug:/path,slug:/path)');
    process.exit(1);
  }
  const repos = new Map<string, string>();
  for (const entry of reposRaw.split(',')) {
    const colonIdx = entry.indexOf(':');
    if (colonIdx === -1) {
      console.error(`Error: invalid repo format "${entry}" — expected slug:/path`);
      process.exit(1);
    }
    const slug = entry.slice(0, colonIdx).trim();
    const repoPath = entry.slice(colonIdx + 1).trim();
    if (!slug || !repoPath) {
      console.error(`Error: invalid repo format "${entry}" — expected slug:/path`);
      process.exit(1);
    }
    const resolved = resolve(repoPath);
    if (!existsSync(resolved)) {
      console.error(`Error: repo path does not exist: ${resolved}`);
      process.exit(1);
    }
    repos.set(slug, resolved);
  }

  return { token, repos, server, maxJobs, jobTimeoutMin, verbose, requireApproval };
}

async function main() {
  const config = parseArgs(process.argv);

  const { banner, shuttingDown } = await import('./ui.js');
  banner('0.1.0');

  if (config.verbose) {
    log('info', 'Starting workforce0-agent', {
      server: config.server,
      repos: [...config.repos.keys()],
      maxJobs: config.maxJobs,
    });
  }

  // Client will be imported in Task 2
  const { AgentClient } = await import('./client.js');
  const client = new AgentClient(config);

  const shutdown = async () => {
    if (config.verbose) {
      log('info', 'Shutting down...');
    } else {
      shuttingDown();
    }
    await client.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await client.start();
}

main().catch(async (err) => {
  log('error', (err as Error).message);
  try {
    const { error: uiError } = await import('./ui.js');
    uiError((err as Error).message);
  } catch {
    // ignore ui import errors
  }
  process.exit(1);
});
