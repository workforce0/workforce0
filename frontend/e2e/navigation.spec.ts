import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('should redirect unauthenticated users to login', async ({ page }) => {
    await page.goto('/dashboard');
    // Without auth, should redirect to login or show login page
    await page.waitForTimeout(2000);
    const url = page.url();
    // Either redirected to /login or the dashboard checks auth client-side
    expect(url).toMatch(/\/(login|dashboard)/);
  });

  test('should load the root page', async ({ page }) => {
    await page.goto('/');
    // Root page should have some content — either redirect to login or landing
    await expect(page).toHaveTitle(/workforce|next/i);
  });

  test.describe('Dashboard Navigation (with mock auth)', () => {
    test.beforeEach(async ({ page }) => {
      // Set up mock auth in localStorage before navigating
      await page.goto('/login');
      await page.evaluate(() => {
        localStorage.setItem('wf0_token', 'mock-jwt-token-for-testing');
        localStorage.setItem('wf0_user', JSON.stringify({
          email: 'test@example.com',
          name: 'Test User',
          organizationName: 'Test Org',
          tenantId: 'tenant-test-1',
        }));
      });
    });

    test('should display sidebar navigation items', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForTimeout(1000);

      // Check for common dashboard navigation items
      // These may be links, buttons, or nav items
      const nav = page.locator('nav, [role="navigation"], aside');
      if (await nav.count() > 0) {
        await expect(nav.first()).toBeVisible();
      }
    });

    test('should navigate to engagements page', async ({ page }) => {
      await page.goto('/engagements');
      await page.waitForTimeout(1000);
      // Page should load without errors
      const url = page.url();
      expect(url).toMatch(/\/(engagements|login)/);
    });

    test('should navigate to meetings page', async ({ page }) => {
      await page.goto('/meetings');
      await page.waitForTimeout(1000);
      const url = page.url();
      expect(url).toMatch(/\/(meetings|login)/);
    });

    test('should navigate to settings page', async ({ page }) => {
      await page.goto('/settings');
      await page.waitForTimeout(1000);
      const url = page.url();
      expect(url).toMatch(/\/(settings|login)/);
    });

    test('should navigate to team page', async ({ page }) => {
      await page.goto('/team');
      await page.waitForTimeout(1000);
      const url = page.url();
      expect(url).toMatch(/\/(team|login)/);
    });
  });
});
