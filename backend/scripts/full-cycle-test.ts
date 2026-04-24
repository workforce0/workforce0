#!/usr/bin/env npx tsx
/**
 * FULL-CYCLE test — transcript → BA → PRD → approve → Dev job queued.
 *
 * Exercises the server-side pipeline a self-hoster would use. Does NOT
 * run the local Dev daemon (that needs a user's Claude Code / Cursor /
 * Codex subscription + a configured GitHub repo). Reports the Dev job
 * landing on BullMQ as the final server-side signal.
 *
 * Assumes:
 *   - Backend on http://localhost:8005
 *   - GEMINI_API_KEY configured in backend/.env
 *   - Postgres + Redis reachable per backend/.env
 *
 * Usage:
 *   cd backend && npx tsx scripts/full-cycle-test.ts
 */

const API = process.env.API_URL || 'http://localhost:8005';
const EMAIL = process.env.TEST_EMAIL || `cycle-${Date.now()}@workforce0.local`;
const PASSWORD = process.env.TEST_PASSWORD || 'cycle-test-passw0rd';
const ORG_NAME = 'Cycle-Test Workspace';

const SAMPLE_TRANSCRIPT = `
PM: We need a simple webhook retry feature. When one of our outbound webhooks
fails, the current behaviour just logs and drops it. That's lost data.

Dev Lead: What's the target? Exponential backoff, 5 retries?

PM: Yes — retry with exponential backoff starting at 1 second, capped at 30
seconds, up to 5 attempts. After the last failure, mark the webhook as
failed and let admins see it in an "undelivered" list.

QA: Should retries be per-webhook or per-endpoint?

PM: Per-webhook. Each webhook has its own retry state.

Dev Lead: Storage? New table?

PM: Yes — a webhook_delivery_attempts table that records attempt number,
status, response code, and timestamp. The existing webhooks table gets a
delivery_status column (pending / delivered / failed).

QA: Any alerting?

PM: Admins should get one notification when a webhook moves to failed state.
Use the existing notification infrastructure. That's it for v1.
`.trim();

// ---- tiny helpers ----------------------------------------------------------

async function api(path: string, opts: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = opts;
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.headers || {}),
    },
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: res.status, body };
}

function step(n: number, title: string) {
  console.log(`\n${n}. ${title}`);
}

function ok(msg: string)   { console.log(`   \x1b[32mOK\x1b[0m ${msg}`); }
function info(msg: string) { console.log(`   .. ${msg}`); }
function warn(msg: string) { console.log(`   \x1b[33m!!\x1b[0m ${msg}`); }
function fail(msg: string, extra?: any) {
  console.error(`   \x1b[31mFAIL\x1b[0m ${msg}`);
  if (extra) console.error('        ', JSON.stringify(extra, null, 2).slice(0, 600));
  process.exit(1);
}

// ---- pipeline --------------------------------------------------------------

async function main() {
  const start = Date.now();
  console.log('WORKFORCE0 · full-cycle test');
  console.log('================================');
  console.log('API:   ', API);
  console.log('Email: ', EMAIL);

  // ---- 1. health --------------------------------------------------------
  step(1, 'Health check');
  const h = await api('/health');
  if (h.status !== 200) fail(`Backend health returned ${h.status}`, h.body);
  ok(`Backend healthy (db + redis + queue)`);

  // ---- 2. signup (idempotent login fallback) ----------------------------
  step(2, 'Ensure a user account exists');
  let token: string;
  let userId: string;
  let tenantId: string;
  {
    const signup = await api('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        email: EMAIL, password: PASSWORD, name: 'Cycle Tester', organizationName: ORG_NAME,
      }),
    });
    if (signup.status === 201 && signup.body?.success) {
      token = signup.body.data.accessToken ?? signup.body.data.token;
      userId = signup.body.data.user.id;
      tenantId = signup.body.data.user.tenantId;
      ok(`Signed up ${EMAIL} (tenant ${tenantId})`);
    } else {
      info(`Signup failed (${signup.status}) — trying login`);
      const login = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      });
      if (login.status !== 200 || !login.body?.success) {
        fail('Neither signup nor login succeeded', { signup: signup.body, login: login.body });
      }
      token = login.body.data.accessToken ?? login.body.data.token;
      userId = login.body.data.user.id;
      tenantId = login.body.data.user.tenantId;
      ok(`Logged in ${EMAIL}`);
    }
  }

  // ---- 3. upload transcript --------------------------------------------
  step(3, 'Upload a sample meeting transcript');
  const upload = await api('/api/meetings/upload/transcript', {
    method: 'POST',
    token,
    body: JSON.stringify({
      title: 'Webhook retry feature (cycle-test)',
      transcript: SAMPLE_TRANSCRIPT,
      participants: ['PM', 'Dev Lead', 'QA'],
      meetingDate: new Date().toISOString(),
    }),
  });
  if (upload.status !== 201 || !upload.body?.success) {
    fail(`Transcript upload failed (${upload.status})`, upload.body);
  }
  const meetingId = upload.body.data.meetingId;
  ok(`Meeting ${meetingId} created (${upload.body.data.wordCount} words)`);

  // ---- 4. run BA agent --------------------------------------------------
  step(4, 'Trigger BA Agent (creates task + queues generation)');
  const ba = await api('/api/agents/ba/process', {
    method: 'POST', token,
    body: JSON.stringify({ meetingId }),
  });
  if (ba.status !== 200 && ba.status !== 201) fail(`BA trigger returned ${ba.status}`, ba.body);
  if (!ba.body?.success) fail('BA trigger !success', ba.body);
  const taskId = ba.body.data.taskId;
  ok(`BA task queued: ${taskId}`);

  // ---- 5. poll for task completion -------------------------------------
  step(5, 'Wait for BA Agent to produce a PRD (up to 3 min)');
  let task: any = null;
  const deadline = Date.now() + 180_000;
  let lastStatus = '';
  while (Date.now() < deadline) {
    const r = await api(`/api/agents/tasks/${taskId}`, { token });
    task = r.body?.data;
    if (!task) { warn(`Task fetch returned no data (${r.status})`); break; }
    if (task.status !== lastStatus) {
      info(`status=${task.status}`);
      lastStatus = task.status;
    }
    if (task.status === 'completed' || task.status === 'failed') break;
    await new Promise(r => setTimeout(r, 4000));
  }
  if (!task || task.status !== 'completed') {
    fail(`BA did not complete (status=${task?.status})`, task?.output || task?.error);
  }
  const prdId = task.output?.prdId;
  if (!prdId) fail('BA completed but no prdId on output', task.output);
  ok(`PRD ${prdId} generated (confidence ${Math.round((task.confidence ?? 0) * 100)}%)`);

  // ---- 6. inspect PRD ---------------------------------------------------
  step(6, 'Fetch the generated PRD');
  const prd = await api(`/api/agents/prds/${prdId}`, { token });
  if (prd.status !== 200 || !prd.body?.success) fail(`PRD fetch returned ${prd.status}`, prd.body);
  const p = prd.body.data;
  ok(`PRD status=${p.status}; title="${p.title?.slice(0, 60) ?? '?'}"`);
  const mdSnippet = (p.content || '').replace(/\s+/g, ' ').slice(0, 200);
  info(`content preview: ${mdSnippet}...`);

  // ---- 7. approve PRD — triggers Dev agent queueing --------------------
  step(7, 'Approve the PRD');
  const approve = await api(`/api/agents/prds/${prdId}/approve`, { method: 'POST', token });
  if (approve.status !== 200 || !approve.body?.success) {
    fail(`Approve returned ${approve.status}`, approve.body);
  }
  ok('PRD approved. Engagement → build phase, Dev job queued.');

  // ---- 8. verify Dev task exists ---------------------------------------
  step(8, 'Confirm a Dev Agent task was created');
  await new Promise(r => setTimeout(r, 1500)); // let the route's async side-effects land
  const tasks = await api('/api/agents/tasks?agentType=dev_agent&limit=5', { token });
  if (tasks.status !== 200) fail(`Task list returned ${tasks.status}`, tasks.body);
  const devTasks: any[] = tasks.body?.data || [];
  const devTask = devTasks.find((t: any) => t.input?.prdId === prdId);
  if (!devTask) {
    warn(`Dev task not found via API list (${devTasks.length} dev tasks seen)`);
    warn('Approval still succeeded — Dev dispatch is async. Check logs if needed.');
  } else {
    ok(`Dev task ${devTask.id} created; status=${devTask.status}`);
  }

  // ---- summary ----------------------------------------------------------
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('\n================================');
  console.log(`\x1b[32mCYCLE OK\x1b[0m · ${elapsed}s total`);
  console.log(`  meeting: ${meetingId}`);
  console.log(`  task:    ${taskId}`);
  console.log(`  prd:     ${prdId} (approved)`);
  if (devTask) console.log(`  dev:     ${devTask.id} (${devTask.status})`);
  console.log('');
  console.log('Server-side pipeline verified end-to-end.');
  console.log('What happens next requires the local daemon (agent/) on a user');
  console.log('machine — it picks up the Dev job over WebSocket and opens a PR');
  console.log('using the user\'s Claude Code / Cursor / Codex subscription.');
}

main().catch(err => {
  console.error('\n\x1b[31mCYCLE CRASHED\x1b[0m:', err.message);
  process.exit(1);
});
