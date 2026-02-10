import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// CDP connection
// ---------------------------------------------------------------------------

const CDP_ENDPOINT = 'http://localhost:9222';

/**
 * Connect to the running Archivist Desktop WebView2 instance over CDP.
 * Returns { browser, context, page } — caller is responsible for
 * browser.close() when done.
 */
export async function connectToApp(): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
}> {
  const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
  const context = browser.contexts()[0];
  if (!context) throw new Error('No browser context found — is the app running?');
  const page = context.pages()[0];
  if (!page) throw new Error('No page found — is the app window visible?');
  return { browser, context, page };
}

// ---------------------------------------------------------------------------
// Wait helpers
// ---------------------------------------------------------------------------

/**
 * Wait until a TCP port is accepting connections (polls every 500 ms).
 * Useful for waiting on the sidecar API (8080) or CDP (9222).
 */
export async function waitForPort(port: number, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  const net = await import('net');

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
    await sleep(500);
  }
  throw new Error(`Port ${port} not reachable after ${timeoutMs} ms`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Sidecar REST API helpers
// ---------------------------------------------------------------------------

const SIDECAR_BASE = 'http://127.0.0.1:8080/api/archivist/v1';

export interface DebugInfo {
  id: string;
  addrs: string[];
  spr?: string;
  archivist?: { version: string };
}

export interface SpaceInfo {
  totalBlocks: number;
  quotaMaxBytes: number;
  quotaUsedBytes: number;
  quotaReservedBytes: number;
}

/** GET /debug/info — node identity, addresses, version */
export async function apiDebugInfo(): Promise<DebugInfo> {
  const res = await fetch(`${SIDECAR_BASE}/debug/info`);
  if (!res.ok) throw new Error(`/debug/info returned ${res.status}`);
  return res.json();
}

/** GET /spr — Signed Peer Record */
export async function apiSpr(): Promise<string> {
  const res = await fetch(`${SIDECAR_BASE}/spr`);
  if (!res.ok) throw new Error(`/spr returned ${res.status}`);
  return res.text();
}

/** GET /space — storage summary */
export async function apiSpace(): Promise<SpaceInfo> {
  const res = await fetch(`${SIDECAR_BASE}/space`);
  if (!res.ok) throw new Error(`/space returned ${res.status}`);
  return res.json();
}

/** POST /data — upload a small test file, returns the CID (plain text). */
export async function apiUploadFile(
  content: string | Buffer,
  filename = 'e2e-test.txt',
  mime = 'text/plain',
): Promise<string> {
  const body = typeof content === 'string' ? Buffer.from(content) : content;
  const res = await fetch(`${SIDECAR_BASE}/data`, {
    method: 'POST',
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    body,
  });
  if (!res.ok) throw new Error(`POST /data returned ${res.status}`);
  return (await res.text()).trim();
}

/** DELETE /data/{cid} */
export async function apiDeleteFile(cid: string): Promise<void> {
  const res = await fetch(`${SIDECAR_BASE}/data/${cid}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE /data/${cid} returned ${res.status}`);
}

/** GET /data — list stored CIDs */
export async function apiListFiles(): Promise<{ content: Array<{ cid: string }> }> {
  const res = await fetch(`${SIDECAR_BASE}/data`);
  if (!res.ok) throw new Error(`GET /data returned ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Common CSS selectors (derived from source in src/pages/*.tsx)
// ---------------------------------------------------------------------------

export const SEL = {
  // Onboarding
  splashScreen: '.splash-screen',
  splashSkip: '.splash-skip',
  welcomeScreen: '.welcome-screen',
  getStarted: '.btn-primary.btn-large',           // "Get Started" button
  skipForNow: '.btn-text',                         // "Skip for now" button
  nodeStartingScreen: '.node-starting-screen',
  nodeStatusReady: '.status-icon.ready',
  folderSelectScreen: '.folder-select-screen',
  quickBackupBtn: '.folder-option.recommended',
  chooseFolderBtn: '.folder-option:not(.recommended)',
  syncingScreen: '.syncing-screen',
  continueBtn: '.sync-complete-message .btn-primary.btn-large', // "Continue to Dashboard"

  // App shell
  sidebar: '.sidebar',
  navLink: '.nav-link',
  mainContent: '.main-content',

  // Dashboard
  pageHeader: '.page-header h2',
  statusDot: '.status-dot',
  statusHero: '.status-hero',
  viewModeBasic: '.view-mode-toggle button:first-child',
  viewModeAdvanced: '.view-mode-toggle button:last-child',
  diagnosticsToggle: '.diagnostics-header button',
  runDiagnostics: '.diagnostics-content button.secondary',
  diagnosticResults: '.diagnostic-results',
  quickStats: '.quick-stats',

  // Files
  filesHeader: '.page-header h2',
  uploadBtn: '.actions button:first-child',
  cidInput: '.download-by-cid input[type="text"]',
  cidInputValid: '.cid-input-valid',
  cidInputInvalid: '.cid-input-invalid',
  cidValidationError: '.cid-validation-error',
  filesTable: '.files-table',
  emptyState: '.empty-state',
  fileRow: '.files-table tbody tr',

  // Sync
  syncStatusCard: '.sync-status-card',
  watchedFolders: '.watched-folders',

  // Logs
  logsContainer: '.logs-container',
  logsViewer: '.logs-viewer',
  logsHeader: '.logs-header h1',
  lineCountSelect: '.logs-controls select',
  autoRefreshCheckbox: '.logs-controls input[type="checkbox"]',
  copyAllBtn: '.btn-secondary:has-text("Copy All")',
  logLine: '.log-line',
  errorMessage: '.logs-container .error-message',

  // Settings
  settingsHeader: '.page-header h2',
  saveBtn: '.actions button:last-child',
  resetBtn: '.actions button.secondary',
  successBanner: '.success-banner',
  settingsSection: '.settings-section',
  apiPortInput: 'input[type="number"]',             // first number input in Node section
  errorBanner: '.error-banner',

  // Devices
  devicesPage: '.devices-page',
  thisDevice: '.this-device',
  peerIdCopyBtn: '.btn-small',
  sprCopyBtn: '.btn-small.secondary',
  addDeviceLink: '.btn-primary:has-text("Add Device")',
  deviceBadgeOnline: '.device-badge.online',
  deviceBadgeOffline: '.device-badge.offline',

  // Add Device
  addDevicePage: '.add-device-page',
  peerAddressInput: '#peer-address',
  connectBtn: '.primary',
  wizardError: '.wizard-error',

  // Media Download
  mediaDownloadPage: '.media-download-page',
  mediaDownloadHeader: '.media-download-page h1',
  urlInput: '.url-input-row input[type="text"]',
  fetchBtn: '.fetch-btn',
  setupBanner: '.setup-banner',
  downloadQueue: '.download-queue',
  queueEmpty: '.queue-empty',
  binaryInfo: '.binary-info',
} as const;

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/** Click a sidebar nav link by visible text. */
export async function navigateTo(page: Page, label: string): Promise<void> {
  // Expand the Advanced accordion if targeting Logs / Settings / Backup Server
  const advancedTargets = ['Logs', 'Backup Server', 'Settings'];
  if (advancedTargets.includes(label)) {
    // Use the sidebar-scoped accordion header to avoid matching Dashboard "Advanced" toggle
    const accordion = page.locator('.sidebar .nav-accordion-header');
    // Check if the target link is already visible inside the sidebar
    const targetLink = page.locator(`.sidebar .nav-link:has-text("${label}")`);
    if (!(await targetLink.isVisible({ timeout: 1000 }).catch(() => false))) {
      await accordion.click();
      await page.waitForTimeout(500);
    }
  }

  await page.locator(`.sidebar .nav-link:has-text("${label}")`).click();
  await page.waitForLoadState('networkidle');
}
