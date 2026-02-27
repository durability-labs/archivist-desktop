import { test, expect } from '@playwright/test';
import {
  connectToApp,
  waitForPort,
  sleep,
  apiUploadFile,
  apiListFiles,
  apiDeleteFile,
  apiDownloadFromNetwork,
} from '../helpers';
import {
  connectToSecondApp,
  waitForBothNodes,
  connectPeers,
  disconnectPeers,
  PRIMARY,
  SECONDARY,
} from '../dual-instance';

/**
 * @dual
 * Dual-instance P2P file sync tests.
 *
 * Prerequisites:
 *   - Primary instance running (CDP 9222, API 8080)
 *   - Secondary instance running (CDP 9223, API 9080)
 *     Launch via: powershell -File e2e/launch-second-instance.ps1
 */

test.describe('P2P Sync (dual instance) @dual', () => {
  test.setTimeout(120_000);

  let uploadedCid: string | null = null;

  test.beforeAll(async () => {
    // Wait for both instances to be ready
    await waitForPort(PRIMARY.cdp, 15_000);
    await waitForPort(SECONDARY.cdp, 15_000);
    await waitForBothNodes();
  });

  test('should connect both instances as peers', async () => {
    const app1 = await connectToApp();
    const app2 = await connectToSecondApp();

    try {
      const peerId1 = await connectPeers(app1.page, app2.page);
      expect(peerId1).toBeTruthy();
      expect(peerId1.length).toBeGreaterThan(10);
    } finally {
      await app1.browser.close();
      await app2.browser.close();
    }
  });

  test('should upload a file on Instance 1', async () => {
    const testContent = `p2p-sync-test-${Date.now()}`;
    const cid = await apiUploadFile(testContent, 'p2p-test.txt', 'text/plain', PRIMARY.api);

    expect(cid).toBeTruthy();
    expect(cid.length).toBeGreaterThan(10);

    uploadedCid = cid;

    // Verify it's in Instance 1's file list
    const files = await apiListFiles(PRIMARY.api);
    const found = files.content.some((f) => f.cid === cid);
    expect(found).toBeTruthy();
  });

  test('should download file from network on Instance 2', async () => {
    test.setTimeout(60_000);

    expect(uploadedCid).toBeTruthy();

    // Request download from network on Instance 2
    await apiDownloadFromNetwork(uploadedCid!, SECONDARY.api);

    // Poll until the file appears in Instance 2's file list
    let found = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      await sleep(3_000);
      try {
        const files = await apiListFiles(SECONDARY.api);
        found = files.content.some((f) => f.cid === uploadedCid);
        if (found) break;
      } catch {
        // API might be temporarily unavailable during transfer
      }
    }

    expect(found).toBeTruthy();
  });

  test('should verify file content matches', async () => {
    expect(uploadedCid).toBeTruthy();

    // Download the file from Instance 2 and verify content
    const res = await fetch(
      `http://127.0.0.1:${SECONDARY.api}/api/archivist/v1/data/${uploadedCid}`,
    );
    expect(res.ok).toBeTruthy();

    const content = await res.text();
    expect(content).toContain('p2p-sync-test-');
  });

  test.afterAll(async () => {
    // Clean up: delete the test file from both instances
    if (uploadedCid) {
      await apiDeleteFile(uploadedCid, PRIMARY.api).catch(() => {});
      await apiDeleteFile(uploadedCid, SECONDARY.api).catch(() => {});
    }

    // Disconnect peers
    try {
      const app2 = await connectToSecondApp();
      await disconnectPeers(app2.page);
      await app2.browser.close();
    } catch {
      // Second instance may not be running
    }
  });
});
