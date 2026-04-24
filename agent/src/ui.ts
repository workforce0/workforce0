// ANSI color helpers — no dependencies needed
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';

export function banner(version: string) {
  console.log(`
${BOLD}${CYAN}  Workforce0 Agent${RESET} ${DIM}v${version}${RESET}
${DIM}  AI workforce that builds features from meetings${RESET}
`);
}

export function status(msg: string) {
  console.log(`${DIM}[${timestamp()}]${RESET} ${msg}`);
}

export function connected(agentId: string, _tenantId: string) {
  console.log(`${GREEN}✓${RESET} Connected to hub ${DIM}(agent: ${agentId.slice(0, 8)}...)${RESET}`);
}

export function registered(repoCount: number, repos: string[]) {
  console.log(`${GREEN}✓${RESET} Registered ${BOLD}${repoCount}${RESET} repos: ${repos.map(r => `${CYAN}${r}${RESET}`).join(', ')}`);
  console.log(`\n${DIM}  Waiting for jobs...${RESET}\n`);
}

export function newJob(jobId: string, action: string, payload: Record<string, unknown>) {
  const actionLabel = formatAction(action);
  console.log(`${YELLOW}●${RESET} ${BOLD}New job:${RESET} ${actionLabel} ${DIM}(${jobId.slice(0, 8)})${RESET}`);
  if (payload.title) console.log(`  ${DIM}Title:${RESET}  ${payload.title}`);
  if (payload.targetRepo) console.log(`  ${DIM}Repo:${RESET}   ${CYAN}${payload.targetRepo}${RESET}`);
  if (payload.branch) console.log(`  ${DIM}Branch:${RESET} ${payload.branch}`);
}

export function jobProgress(message: string, percent: number) {
  const bar = progressBar(percent);
  process.stdout.write(`\r  ${bar} ${DIM}${message}${RESET}    `);
}

export function jobDone(data: Record<string, unknown>) {
  process.stdout.write('\r' + ' '.repeat(80) + '\r'); // Clear progress line
  console.log(`${GREEN}✓${RESET} ${BOLD}Done!${RESET}`);
  if (data.prUrl) console.log(`  ${DIM}PR:${RESET} ${BLUE}${data.prUrl}${RESET}`);
  if (data.filesChanged) console.log(`  ${DIM}Files:${RESET} ${data.filesChanged} changed`);
  console.log('');
}

export function jobFailed(errorMsg: string) {
  process.stdout.write('\r' + ' '.repeat(80) + '\r');
  console.log(`${RED}✗${RESET} ${BOLD}Failed:${RESET} ${errorMsg}`);
  console.log('');
}

export function disconnected(reason: string) {
  console.log(`${YELLOW}!${RESET} Disconnected: ${reason}`);
}

export function reconnecting(delay: number) {
  console.log(`${DIM}  Reconnecting in ${delay / 1000}s...${RESET}`);
}

export function shuttingDown() {
  console.log(`\n${DIM}Shutting down...${RESET}`);
}

export function error(msg: string) {
  console.log(`${RED}✗${RESET} ${msg}`);
}

function timestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

function formatAction(action: string): string {
  switch (action) {
    case 'implement_prd': return `${MAGENTA}Implement Feature${RESET}`;
    case 'review_pr': return `${BLUE}Review PR${RESET}`;
    case 'run_tests': return `${CYAN}Run Tests${RESET}`;
    default: return action;
  }
}

function progressBar(percent: number): string {
  const width = 20;
  const filled = Math.round(width * percent / 100);
  const empty = width - filled;
  return `${GREEN}${'█'.repeat(filled)}${DIM}${'░'.repeat(empty)}${RESET} ${percent}%`;
}
