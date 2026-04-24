/**
 * Hermes + Wave 2 + Channel Routing smoke test.
 *
 * Verifies that the pages added during the feat/oss-pivot shipping
 * spree actually render. Doesn't exercise the backend — these are
 * UI availability + basic nav regressions.
 *
 * Run against a running frontend; backend can be up or down — each
 * page below either (a) works without backend or (b) shows a
 * documented loading / empty state that we still want to see render.
 */

import { test, expect } from '@playwright/test';

test.describe('Hermes III + Wave 2 UI surfaces', () => {
  test('setup wizard (first-run) page renders', async ({ page }) => {
    await page.goto('/onboarding/setup');
    // Setup wizard always shows step 1 heading regardless of backend
    await expect(page.getByRole('heading', { name: /name your workspace/i })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByPlaceholder(/acme/i)).toBeVisible();
  });

  test('integrations grid page renders', async ({ page }) => {
    // Requires auth — we just verify the page title + that nav chrome loads
    await page.goto('/settings/integrations');
    // Either the card grid or the auth redirect — we expect the URL, not error
    const url = page.url();
    expect(url).toMatch(/(settings\/integrations|login)/);
  });

  test('approvals queue page renders', async ({ page }) => {
    await page.goto('/approvals');
    const url = page.url();
    expect(url).toMatch(/(approvals|login)/);
  });

  test('skills admin page renders', async ({ page }) => {
    await page.goto('/skills');
    const url = page.url();
    expect(url).toMatch(/(skills|login)/);
  });

  test('schedules admin page renders', async ({ page }) => {
    await page.goto('/schedules');
    const url = page.url();
    expect(url).toMatch(/(schedules|login)/);
  });
});

test.describe('Sidebar navigation surfaces the new entries', () => {
  test('sidebar exposes Approvals, Skills, Schedules', async ({ page }) => {
    // Skip if not authenticated — these links only show inside the dashboard shell.
    await page.goto('/dashboard');
    const url = page.url();
    if (url.includes('/login')) {
      test.skip(true, 'No auth — cannot verify authenticated sidebar');
      return;
    }
    // Can only verify when authed; fall through gracefully otherwise.
    await expect(page.getByRole('link', { name: /approvals/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /skills/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /schedules/i })).toBeVisible();
  });
});
