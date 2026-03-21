import {
  waitForPort,
  sleep,
  apiUploadFile,
  apiListFiles,
  apiDeleteFile,
  apiDownloadFromNetwork,
  SEL,
} from '../helpers';
import {
  connectToSecondApp,
  closeSecondApp,
  waitForBothNodes,
  connectPeers,
  disconnectPeers,
  PRIMARY,
  SECONDARY,
} from '../dual-instance';
import type { Browser as RemoteBrowser } from 'webdriverio';

/**
 * @dual
 * Dual-instance P2P file sync tests (WebdriverIO + tauri-driver).
 *
 * Prerequisites:
 *   - Primary instance running (API 8080)
 *   - Secondary instance launched via connectToSecondApp() (API 9080)
 */

describe('P2P Sync (dual instance) @dual', function () {
  this.timeout(120_000);

  let secondBrowser: RemoteBrowser;
  let uploadedCid: string | null = null;

  before(async () => {
    await waitForPort(PRIMARY.api, 15_000);
    await waitForBothNodes();
  });

  after(async () => {
    // Clean up: delete the test file from both instances
    if (uploadedCid) {
      await apiDeleteFile(uploadedCid, PRIMARY.api).catch(() => {});
      await apiDeleteFile(uploadedCid, SECONDARY.api).catch(() => {});
    }

    // Disconnect peers and close second instance
    try {
      if (secondBrowser) {
        await disconnectPeers(secondBrowser);
        await closeSecondApp(secondBrowser);
      }
    } catch {
      // Second instance may not be running
    }
  });

  it('should connect both instances as peers', async () => {
    secondBrowser = await connectToSecondApp();

    const peerId1 = await connectPeers(secondBrowser);
    expect(peerId1).toBeTruthy();
    expect(peerId1.length).toBeGreaterThan(10);
  });

  it('should upload a file on Instance 1', async () => {
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

  it('should download file from network on Instance 2', async function () {
    this.timeout(60_000);

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

  it('should verify file content matches', async () => {
    expect(uploadedCid).toBeTruthy();

    // Download the file from Instance 2 and verify content
    const res = await fetch(
      `http://127.0.0.1:${SECONDARY.api}/api/archivist/v1/data/${uploadedCid}`,
    );
    expect(res.ok).toBeTruthy();

    const content = await res.text();
    expect(content).toContain('p2p-sync-test-');
  });
});
