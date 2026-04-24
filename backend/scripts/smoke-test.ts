#!/usr/bin/env npx tsx
/**
 * Smoke Test — validates the full transcript-to-PRD pipeline with real AI.
 *
 * Usage:
 *   cd mvp && npx tsx scripts/smoke-test.ts
 *
 * Requires:
 *   - Backend running at localhost:8005
 *   - GEMINI_API_KEY configured
 *   - Admin user exists (admin@workforce0.com / admin123456)
 */

const API = 'http://localhost:8005';
const EMAIL = 'admin@workforce0.com';
const PASSWORD = 'admin123456';

const SAMPLE_TRANSCRIPT = `
PM: For this sprint, we need to add a notification system. When an agent completes a task,
the user should get a notification in the app and optionally via email.

Dev Lead: Should we support real-time notifications or just polling?

PM: Real-time using server-sent events. We already have SSE infrastructure.

Dev Lead: What about email? Do we need that for MVP?

PM: Email is nice to have. Let's make it optional — users can toggle it in settings.
For MVP, just in-app notifications via SSE.

QA: What notification types do we need?

PM: Three types: task completed, task failed, and brief needs review.
Each should have a title, message, and a link to the relevant page.

Dev Lead: Should we persist notifications in the database?

PM: Yes, store them so users can see their notification history.
Mark as read/unread. Show a badge count in the nav bar.
`.trim();

async function main() {
  const start = Date.now();
  console.log('Workforce0 Smoke Test');
  console.log('========================\n');

  // Step 1: Login
  console.log('1. Logging in...');
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const loginData = await loginRes.json() as any;
  if (!loginData.success) {
    console.error('FAIL Login failed:', loginData.error);
    process.exit(1);
  }
  const token = loginData.data.token;
  console.log('   OK Logged in\n');

  // Step 2: Upload transcript
  console.log('2. Uploading transcript...');
  const uploadRes = await fetch(`${API}/api/meetings/upload/transcript`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ title: 'Smoke Test - Notification System', transcript: SAMPLE_TRANSCRIPT }),
  });
  const uploadData = await uploadRes.json() as any;
  if (!uploadData.success) {
    console.error('FAIL Upload failed:', uploadData.error);
    process.exit(1);
  }
  const meetingId = uploadData.data.meetingId;
  console.log(`   OK Meeting created: ${meetingId} (${uploadData.data.wordCount} words)\n`);

  // Step 3: Trigger BA Agent
  console.log('3. Triggering BA Agent...');
  const baRes = await fetch(`${API}/api/agents/ba/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ meetingId }),
  });
  const baData = await baRes.json() as any;
  if (!baData.success) {
    console.error('FAIL BA Agent trigger failed:', baData.error);
    process.exit(1);
  }
  const taskId = baData.data.taskId;
  console.log(`   OK Task created: ${taskId}\n`);

  // Step 4: Poll for completion
  console.log('4. Waiting for BA Agent to complete...');
  let task: any = null;
  const pollStart = Date.now();
  const maxWait = 120_000; // 2 minutes

  while (Date.now() - pollStart < maxWait) {
    const taskRes = await fetch(`${API}/api/agents/tasks/${taskId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const taskData = await taskRes.json() as any;
    task = taskData.data;

    if (task.status === 'completed' || task.status === 'failed') break;

    process.stdout.write(`   Polling... Status: ${task.status} (${Math.round((Date.now() - pollStart) / 1000)}s)\r`);
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log('');

  if (!task || task.status !== 'completed') {
    console.error(`FAIL BA Agent did not complete. Status: ${task?.status}, Error: ${task?.error}`);
    process.exit(1);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`   OK Completed in ${elapsed}s with ${(task.confidence * 100).toFixed(0)}% confidence\n`);

  // Step 5: Validate output
  console.log('5. Validating output...');
  const output = task.output || {};
  const prdId = output.prdId;
  const council = output.council || {};
  const cost = council.estimatedCost?.total || 0;

  let passed = true;
  const checks: { name: string; ok: boolean }[] = [
    { name: 'Task completed', ok: task.status === 'completed' },
    { name: 'Confidence > 0', ok: task.confidence > 0 },
    { name: 'PRD created', ok: !!prdId },
    { name: 'Council voted', ok: !!(council.votes?.length) },
  ];

  for (const check of checks) {
    console.log(`   ${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
    if (!check.ok) passed = false;
  }

  console.log('\n========================');
  console.log(`Result: ${passed ? 'PASS' : 'FAIL'}`);
  console.log(`Time: ${elapsed}s`);
  console.log(`Cost: $${cost.toFixed(4)}`);
  console.log(`Confidence: ${(task.confidence * 100).toFixed(0)}%`);
  console.log(`PRD ID: ${prdId || 'none'}`);
  console.log(`Council Decision: ${output.councilDecision || 'unknown'}`);

  process.exit(passed ? 0 : 1);
}

main().catch(err => {
  console.error('FAIL Smoke test crashed:', err.message);
  process.exit(1);
});
