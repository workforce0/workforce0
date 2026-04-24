#!/usr/bin/env node
/**
 * ONE-COMMAND LOCAL ONBOARD
 * =============================================================================
 *
 *   npx workforce0 onboard [--yes] [--demo]
 *
 * What it does, in order:
 *   1. Detects Docker + docker-compose. Bails out with an install link if
 *      they're missing.
 *   2. Generates a strong JWT_SECRET, copies .env.example → .env if the
 *      file doesn't exist, and inserts the secret (never overwrites an
 *      existing file — that would destroy user config).
 *   3. Prompts for the GEMINI_API_KEY unless --yes + env provided one.
 *   4. `docker compose up -d` from the repo root.
 *   5. Waits for the backend /health to return 200.
 *   6. Optionally runs the demo seed (--demo) so the app has content.
 *   7. Prints the login URL and opens the browser.
 *
 * Goal: from `git clone` to logged-in UI in under 2 minutes with a single
 * command — matches paperclipai's onboarding ergonomics.
 *
 * This script deliberately uses ONLY Node's stdlib. No npm deps, no
 * TypeScript, no bundler. It has to work before `npm install`.
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- tiny term UI helpers --------------------------------------------------

const color = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

function step(n, text) { console.log(`\n${color.bold(`${n}.`)} ${text}`); }
function ok(text) { console.log(`   ${color.green('✓')} ${text}`); }
function info(text) { console.log(`   ${color.dim('·')} ${color.dim(text)}`); }
function warn(text) { console.log(`   ${color.yellow('!')} ${text}`); }
function bye(text, err) {
  console.error(`   ${color.red('✗')} ${text}`);
  if (err) console.error(`     ${color.dim(err.message || err)}`);
  process.exit(1);
}

async function readline(promptText) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(promptText)).trim(); }
  finally { rl.close(); }
}

/**
 * Run a program with args and collect stdout. Never passes through a
 * shell (spawn with shell:false is the default), so argv is safe even
 * if a string happens to contain shell metacharacters.
 */
function run(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    let err = '';
    child.stdout?.on('data', (b) => (out += b.toString()));
    child.stderr?.on('data', (b) => (err += b.toString()));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve({ stdout: out, stderr: err });
      else reject(new Error(`${bin} exited ${code}: ${err.trim() || out.trim()}`));
    });
  });
}

/** Same as run() but inherits stdio so the user sees docker compose output. */
function runInherit(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: 'inherit', ...opts });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${bin} exited ${code}`))));
  });
}

// ---- sub-steps -------------------------------------------------------------

async function requireDocker() {
  try {
    await run('docker', ['--version']);
    await run('docker', ['compose', 'version']);
  } catch (err) {
    bye(
      'Docker + docker compose not found. Install from https://docs.docker.com/get-docker/ and re-run.',
      err,
    );
  }
}

async function writeEnvIfMissing(repoRoot, { yes, providedKey }) {
  const envPath = path.join(repoRoot, '.env');
  const examplePath = path.join(repoRoot, '.env.example');

  if (existsSync(envPath)) {
    ok('.env already exists — leaving it alone');
    return;
  }
  if (!existsSync(examplePath)) {
    bye('.env.example missing from repo root. Are you running this from the workforce0 checkout?');
  }

  copyFileSync(examplePath, envPath);
  ok('.env created from .env.example');

  let body = readFileSync(envPath, 'utf-8');
  const jwt = randomBytes(32).toString('base64url');
  const pg = randomBytes(16).toString('base64url');

  body = body.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${jwt}`);
  if (/^POSTGRES_PASSWORD=/m.test(body)) {
    body = body.replace(/^POSTGRES_PASSWORD=.*$/m, `POSTGRES_PASSWORD=${pg}`);
  }

  let key = providedKey || process.env.GEMINI_API_KEY || '';
  if (!key && !yes) {
    console.log('');
    console.log('   You need a Gemini API key (free tier works fine).');
    console.log('   Get one at: https://aistudio.google.com/apikey');
    console.log('   You can also add it later via Settings → AI Providers in the UI.');
    console.log('');
    key = await readline('   Paste your Gemini API key (or press enter to skip): ');
  }

  if (key) {
    body = body.replace(/^GEMINI_API_KEY=.*$/m, `GEMINI_API_KEY=${key}`);
    ok('Gemini API key saved to .env');
  } else {
    warn('No Gemini key supplied — add one later via Settings → AI Providers');
  }

  writeFileSync(envPath, body);
  ok('Secrets generated (JWT_SECRET, POSTGRES_PASSWORD)');
}

async function composeUp(repoRoot) {
  info('first run pulls images — ~2 minutes on a fresh host');
  await runInherit('docker', ['compose', '-f', 'docker-compose.prod.yml', 'up', '-d'], { cwd: repoRoot });
  ok('containers started');
}

async function waitForHealth(backendPort = 3000) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${backendPort}/health`);
      if (res.ok) return;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  bye('backend never returned /health 200 in 120s — check `docker compose logs backend`');
}

async function maybeSeedDemo(repoRoot, { demo }) {
  if (!demo) return;
  info('seeding demo tenant');
  try {
    await runInherit(
      'docker',
      ['compose', '-f', 'docker-compose.prod.yml', 'exec', '-T', 'backend', 'npm', 'run', 'seed:demo'],
      { cwd: repoRoot },
    );
    ok('demo data seeded');
  } catch (err) {
    warn('demo seed skipped (exec failed — add it later with `docker compose exec backend npm run seed:demo`)');
  }
}

async function openBrowser(url) {
  const bin = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';
  try { await run(bin, [url]); } catch { /* silent — user can click */ }
}

// ---- main ------------------------------------------------------------------

async function main() {
  const args = new Set(process.argv.slice(2));
  const yes = args.has('--yes') || args.has('-y');
  const demo = args.has('--demo');

  const keyFlagIdx = process.argv.indexOf('--key');
  const providedKey = keyFlagIdx > -1 ? process.argv[keyFlagIdx + 1] : undefined;

  // Resolve repo root: script lives at <repo>/scripts/onboard.mjs
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, '..');

  console.log(color.bold('\n  Workforce0 onboarding\n'));

  step(1, 'Checking Docker');
  await requireDocker();
  ok('Docker + docker compose available');

  step(2, 'Generating secrets and .env');
  await writeEnvIfMissing(repoRoot, { yes, providedKey });

  step(3, 'Starting services (postgres, redis, backend, frontend)');
  await composeUp(repoRoot);

  step(4, 'Waiting for backend to come online');
  await waitForHealth(Number(process.env.BACKEND_PORT) || 3000);
  ok('backend healthy');

  if (demo) {
    step(5, 'Seeding demo tenant');
    await maybeSeedDemo(repoRoot, { demo });
  }

  const url = `http://localhost:${process.env.FRONTEND_PORT || 3001}`;
  console.log(`\n  ${color.green('✓ Workforce0 is running.')}  Open ${color.cyan(url)}\n`);
  if (demo) {
    console.log(`  Demo login: ${color.bold('demo@workforce0.local')} / ${color.bold('demo-password-123')}\n`);
  }
  await openBrowser(url);
}

main().catch((err) => {
  console.error(`\n${color.red('onboarding failed:')} ${err.message}`);
  console.error(color.dim(err.stack || ''));
  process.exit(1);
});
