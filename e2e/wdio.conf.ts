import type { Options } from '@wdio/types';
import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';

let tauriDriver: ChildProcess | null = null;

// Check for release build mode via environment variable
const isReleaseBuild = process.env.RELEASE_BUILD === '1' || process.env.RELEASE_BUILD === 'true';

/**
 * Locate the application binary.
 * Set RELEASE_BUILD=1 to use release build instead of debug.
 */
function findBinary(): string {
  const baseDir = path.resolve(__dirname, '..', 'src-tauri', 'target');
  const release = isReleaseBuild;

  const candidates: string[] = release ? [
    // macOS release bundle
    path.join(baseDir, 'release', 'bundle', 'macos', 'Archivist.app', 'Contents', 'MacOS', 'archivist-desktop'),
    // Linux release binary
    path.join(baseDir, 'release', 'archivist-desktop'),
    // Windows release binary
    path.join(baseDir, 'release', 'archivist-desktop.exe'),
  ] : [
    // Linux debug
    path.join(baseDir, 'debug', 'archivist-desktop'),
    // macOS debug bundle
    path.join(baseDir, 'debug', 'bundle', 'macos', 'Archivist Desktop.app', 'Contents', 'MacOS', 'archivist-desktop'),
    // Windows debug
    path.join(baseDir, 'debug', 'archivist-desktop.exe'),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.log(`[wdio] Using ${release ? 'RELEASE' : 'DEBUG'} binary: ${p}`);
      return p;
    }
  }

  const buildCmd = release ? 'pnpm tauri build' : 'pnpm tauri build --debug';
  throw new Error(
    `${release ? 'Release' : 'Debug'} binary not found. Run '${buildCmd}' first.\nSearched:\n  ${candidates.join('\n  ')}`
  );
}

/** Wait until a TCP port is accepting connections. */
async function waitForPort(port: number, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(500);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('timeout', () => { socket.destroy(); resolve(false); });
      socket.once('error', () => { socket.destroy(); resolve(false); });
      socket.connect(port, '127.0.0.1');
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Port ${port} not reachable after ${timeoutMs}ms`);
}

export const config: Options.Testrunner & { capabilities: any[] } = {
  runner: 'local',
  tsConfigPath: './tsconfig.json',

  specs: ['./tests/**/*.spec.ts'],
  exclude: [],

  maxInstances: 1,

  capabilities: [
    {
      maxInstances: 1,
      'tauri:options': {
        application: findBinary(),
        webviewOptions: {},
      },
    } as any,
  ],

  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 180000,
  connectionRetryCount: 3,

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },

  reporters: ['spec'],

  port: 4444,

  /**
   * Start tauri-driver before test session and wait for it to be ready.
   */
  onPrepare: async function () {
    tauriDriver = spawn(
      path.resolve(os.homedir(), '.cargo', 'bin', 'tauri-driver'),
      ['--port', '4444'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    tauriDriver.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.error('[tauri-driver]', msg);
    });

    tauriDriver.on('error', (error) => {
      console.error('[tauri-driver] error:', error);
    });

    await waitForPort(4444, 15000);
  },

  /**
   * Kill tauri-driver after test session.
   */
  onComplete: async function () {
    if (tauriDriver) {
      tauriDriver.kill();
      tauriDriver = null;
    }
  },

  /**
   * Before each worker session: wait for app to load, skip onboarding.
   */
  before: async function () {
    // Wait for the Tauri app webview to load
    await new Promise((r) => setTimeout(r, 5000));

    // Get the current URL to understand the origin
    const url = await browser.getUrl();
    console.log('[wdio] Current URL:', url);

    // Try to set localStorage to skip onboarding
    // May need to wait for the page to have a secure origin
    let lsSet = false;
    for (let i = 0; i < 20; i++) {
      try {
        await browser.execute(() => {
          localStorage.setItem('archivist_onboarding_complete', 'true');
        });
        lsSet = true;
        break;
      } catch (e: any) {
        if (i === 0) console.log('[wdio] localStorage not ready, retrying...');
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (lsSet) {
      // Reload to apply the flag
      try {
        await browser.execute(() => { location.reload(); });
      } catch {
        // If execute still fails, try navigating
        const currentUrl = await browser.getUrl();
        if (currentUrl && currentUrl !== 'about:blank') {
          await browser.url(currentUrl);
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    } else {
      console.log('[wdio] Could not set localStorage — will try to click through onboarding');
    }

    // Wait for either the sidebar (main app) or the onboarding screen
    await new Promise((r) => setTimeout(r, 2000));
  },
};
