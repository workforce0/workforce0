import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(_execFile);

// ---------------------------------------------------------------------------
// prepareRepo
// ---------------------------------------------------------------------------

/**
 * Prepares a local repo for a new agent branch.
 *
 * 1. git fetch origin
 * 2. git checkout -b {branch} origin/main
 *    If that fails, falls back to origin/master
 */
export async function prepareRepo(repoPath: string, branch: string): Promise<void> {
  await execFile('git', ['fetch', 'origin'], { cwd: repoPath });

  try {
    await execFile('git', ['-C', repoPath, 'checkout', '-b', branch, 'origin/main']);
  } catch {
    // Fallback: some repos use master as the default branch
    await execFile('git', ['-C', repoPath, 'checkout', '-b', branch, 'origin/master']);
  }
}

// ---------------------------------------------------------------------------
// pushAndCreatePR
// ---------------------------------------------------------------------------

const PUSH_RETRY_DELAY_MS = 3000;

/**
 * Pushes the branch to origin (with one retry on failure), then creates a
 * GitHub PR via the `gh` CLI.
 *
 * Returns the PR URL on success, or null if:
 *   - push fails after both attempts, or
 *   - gh CLI is not available / pr creation fails
 */
export async function pushAndCreatePR(
  repoPath: string,
  branch: string,
  title: string,
): Promise<string | null> {
  // Push with one retry
  const pushArgs = ['-C', repoPath, 'push', '-u', 'origin', branch];

  let pushSucceeded = false;
  try {
    await execFile('git', pushArgs);
    pushSucceeded = true;
  } catch {
    // Wait then retry once
    await new Promise<void>((resolve) => setTimeout(resolve, PUSH_RETRY_DELAY_MS));
    try {
      await execFile('git', pushArgs);
      pushSucceeded = true;
    } catch {
      // Both attempts failed — not fatal, return null
      return null;
    }
  }

  if (!pushSucceeded) return null;

  // Create PR via gh CLI
  const prBody =
    'This PR was created automatically by the workforce0 agent.\n\n' +
    'Please review the changes and merge when ready.';

  try {
    const { stdout } = await execFile('gh', [
      'pr',
      'create',
      '--title',
      title,
      '--body',
      prBody,
      '--head',
      branch,
    ], { cwd: repoPath });

    // stdout contains the PR URL (last non-empty line)
    const url = stdout
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean)
      .pop();

    return url ?? null;
  } catch {
    // gh CLI not available or PR creation failed — not fatal
    return null;
  }
}

// ---------------------------------------------------------------------------
// detectRemoteUrl
// ---------------------------------------------------------------------------

/**
 * Returns the remote URL for "origin" in the given repo.
 */
export async function detectRemoteUrl(repoPath: string): Promise<string> {
  const { stdout } = await execFile('git', ['-C', repoPath, 'remote', 'get-url', 'origin']);
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// hasUnpushedCommits
// ---------------------------------------------------------------------------

/**
 * Returns true if there are commits on {branch} that are not on origin/main.
 */
export async function hasUnpushedCommits(repoPath: string, branch: string): Promise<boolean> {
  const { stdout } = await execFile('git', [
    '-C',
    repoPath,
    'log',
    `origin/main..${branch}`,
    '--oneline',
  ]);
  return stdout.trim().length > 0;
}
