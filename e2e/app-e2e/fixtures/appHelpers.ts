import { Page, expect } from '@playwright/test';

/**
 * Navigate to a sidebar destination. Settings/Logs live inside an "Advanced"
 * accordion after the UX overhaul — this helper opens the accordion when
 * needed so tests don't care about nav structure.
 */
const ADVANCED_TARGETS = ['Settings', 'Logs'];

export async function navigateTo(page: Page, label: string): Promise<void> {
  if (ADVANCED_TARGETS.includes(label)) {
    const link = page.locator('.sidebar .nav-link', { hasText: label });
    if (!(await link.isVisible().catch(() => false))) {
      const accordion = page.locator('.sidebar .nav-accordion-header', { hasText: 'Advanced' });
      if (await accordion.isVisible().catch(() => false)) {
        await accordion.click();
        await page.waitForTimeout(250);
      }
    }
  }
  await page.locator('.sidebar .nav-link', { hasText: label }).first().click();
  await page.waitForTimeout(300);
}

/**
 * Generate a new wallet and trigger the unlock-and-restart flow. Returns once
 * the "Applying wallet configuration" overlay has cleared.
 *
 * Assumes no existing wallet (use -KeepData only when a wallet already exists).
 */
export async function generateWallet(page: Page, password: string): Promise<void> {
  await navigateTo(page, 'Wallet');

  // Initial wallet page exposes a "Generate New Wallet" button that opens the
  // generate form. If the form is already open (setupMode==='generate'), skip.
  const openFormBtn = page.locator('button', { hasText: 'Generate New Wallet' }).first();
  if (await openFormBtn.isVisible().catch(() => false)) {
    await openFormBtn.click();
    await page.waitForTimeout(300);
  }

  // Now the form should be visible with two password inputs and a submit
  // button labeled "Generate Wallet".
  const pwInputs = page.locator('input[type="password"]');
  await expect(pwInputs.first()).toBeVisible({ timeout: 10_000 });
  await pwInputs.nth(0).fill(password);
  await pwInputs.nth(1).fill(password);

  const submitBtn = page.locator('button[type="submit"]', { hasText: /Generate Wallet/i }).first();
  await submitBtn.click();

  // Wait for the "Applying Wallet Configuration" overlay to appear and clear.
  // Overlay is from src/pages/Wallet.tsx — it renders when restarting.
  const overlay = page.locator('text=Applying Wallet Configuration');
  await overlay
    .waitFor({ state: 'visible', timeout: 30_000 })
    .catch(() => {
      /* overlay may be skipped on very fast hosts */
    });
  await overlay
    .waitFor({ state: 'hidden', timeout: 60_000 })
    .catch(() => {
      /* overlay may stay visible if restart never completes — tests downstream will fail more meaningfully */
    });
  await page.waitForTimeout(500);
}

/** Fill the provider form and click Publish Availability. */
export async function clickPublishAvailability(
  page: Page,
  opts: { maximumDuration?: string } = {},
): Promise<void> {
  await navigateTo(page, 'Make a Deal');
  const btn = page.locator('button', { hasText: /Publish Availability/i }).first();
  await expect(btn).toBeVisible({ timeout: 10_000 });
  // Form defaults are valid (duration = 86400s). Override only if requested.
  if (opts.maximumDuration) {
    const durInput = page
      .locator('.mp-field', { hasText: /Max Duration/i })
      .locator('input')
      .first();
    await durInput.fill(opts.maximumDuration);
  }
  await btn.click();
}
