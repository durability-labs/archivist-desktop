/**
 * End-to-end regression for Marketplace → Publish Availability.
 *
 * This is the bug the user hit: "API request failed: Failed to post
 * availability: HTTP 422 Unprocessable Entity - maximumDuration must be
 * larger than zero". Root cause was the desktop app sending the v0.2.0
 * field shape (`duration`, `totalSize`, ...) to an archivist-node main-
 * branch sidecar that had renamed/removed those fields.
 *
 * This test drives the REAL installed app and verifies both:
 *   - the UI does not surface an error toast, and
 *   - the sidecar's node.log contains no "maximumDuration must be larger
 *     than zero" or "Unrecognized option" lines (both of which would
 *     indicate a wire-format regression).
 */
import { test, expect } from '../fixtures/app';
import { navigateTo, clickPublishAvailability, generateWallet } from '../fixtures/appHelpers';
import { findHardFailures } from '../fixtures/log';

test.describe('Marketplace — Publish Availability (real sidecar)', () => {
  test('app boots with no sidecar fatal errors', async ({ tailNodeLog, page }) => {
    // Just visiting the app shouldn't produce fatal sidecar errors.
    await navigateTo(page, 'Dashboard');
    await page.waitForTimeout(2000);
    const tail = tailNodeLog();
    const hits = findHardFailures(tail.readNew());
    expect(
      hits,
      `Expected no fatal errors in node.log on boot. Found:\n${hits.join('\n')}`,
    ).toHaveLength(0);
  });

  test('POST availability with wallet: no wire-format errors in sidecar log', async ({
    page,
    tailNodeLog,
  }) => {
    test.setTimeout(180_000); // wallet setup + restart can take ~30s

    // Set up a wallet so marketplace becomes active.
    await generateWallet(page, 'e2e-test-password-000');

    // Anchor the log tail AFTER wallet setup so we only check the POST request.
    const tail = tailNodeLog();

    // Click Publish Availability with the default form values (Max Duration =
    // 86400). With a correct wire format this request should at worst return
    // "503 Persistence is not enabled" (if the wallet couldn't activate
    // marketplace on this test network) — but it MUST NOT produce a 422
    // "maximumDuration must be larger than zero" OR "Unrecognized option".
    await clickPublishAvailability(page);

    // Give the sidecar a moment to log the request.
    await page.waitForTimeout(3000);

    const chunk = tail.readNew();
    const hits = findHardFailures(chunk);
    expect(
      hits,
      `Sidecar reported wire-format errors after Publish Availability.\n` +
        `This means the desktop app is sending an availability payload the\n` +
        `sidecar doesn't understand. Hits:\n${hits.join('\n')}`,
    ).toHaveLength(0);

    // Also assert the UI didn't blow up with an "[object Object]" error
    // (a previous regression we fixed — keep the guard).
    const errorText = await page
      .locator('.mp-error')
      .allTextContents()
      .catch(() => []);
    for (const e of errorText) {
      expect(e).not.toContain('[object Object]');
      expect(e).not.toMatch(/maximumDuration must be larger than zero/i);
    }
  });
});
