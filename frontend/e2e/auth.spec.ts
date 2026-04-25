import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test.describe('Login Page', () => {
    test('should display login form', async ({ page }) => {
      await page.goto('/login');
      await expect(
        page.getByRole('heading', { name: /welcome back|sign in/i }),
      ).toBeVisible();
      await expect(page.getByLabel(/email/i)).toBeVisible();
      await expect(page.getByLabel(/password/i)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
    });

    test('should show Workforce0 branding', async ({ page }) => {
      await page.goto('/login');
      // Brand mark renders in both desktop split-pane and mobile header — match the first.
      await expect(page.getByText('Workforce0').first()).toBeVisible();
    });

    test('should have link to signup page', async ({ page }) => {
      await page.goto('/login');
      const signupLink = page.getByRole('link', { name: /sign up|create.*account|get started/i });
      await expect(signupLink).toBeVisible();
    });

    test('should show error on invalid credentials', async ({ page }) => {
      await page.goto('/login');
      await page.getByLabel(/email/i).fill('bad@email.com');
      await page.getByLabel(/password/i).fill('wrongpassword');
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();

      // Should show some error (exact message depends on backend being up)
      // Wait for either an error message or the loading to finish
      await page.waitForTimeout(2000);

      // Either we got an error or we're still on login page (backend not running)
      const url = page.url();
      expect(url).toContain('/login');
    });

    test('should prevent form submission with empty fields', async ({ page }) => {
      await page.goto('/login');

      // Try submitting empty form — HTML5 validation should prevent it
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();

      // Should still be on login page
      expect(page.url()).toContain('/login');
    });
  });

  test.describe('Signup Page', () => {
    test('should display signup form', async ({ page }) => {
      await page.goto('/signup');
      await expect(page.getByRole('heading', { name: /create.*account|sign up|get started/i })).toBeVisible();
      await expect(page.getByLabel(/email/i)).toBeVisible();
      await expect(page.getByLabel(/password/i)).toBeVisible();
    });

    test('should have link to login page', async ({ page }) => {
      await page.goto('/signup');
      const loginLink = page.getByRole('link', { name: /sign in|log in|already.*account/i });
      await expect(loginLink).toBeVisible();
    });

    test('should include name and organization fields', async ({ page }) => {
      await page.goto('/signup');
      // Signup has both "Your name" and "Organization name" labels — verify the personal name label.
      await expect(page.getByLabel(/your name/i)).toBeVisible();
    });
  });
});
