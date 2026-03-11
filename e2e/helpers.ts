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

/** Build the sidecar base URL for a given API port (defaults to 8080). */
function sidecarBase(apiPort = 8080): string {
  return `http://127.0.0.1:${apiPort}/api/archivist/v1`;
}

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
export async function apiDebugInfo(apiPort = 8080): Promise<DebugInfo> {
  const res = await fetch(`${sidecarBase(apiPort)}/debug/info`);
  if (!res.ok) throw new Error(`/debug/info returned ${res.status}`);
  return res.json();
}

/** GET /spr — Signed Peer Record */
export async function apiSpr(apiPort = 8080): Promise<string> {
  const res = await fetch(`${sidecarBase(apiPort)}/spr`);
  if (!res.ok) throw new Error(`/spr returned ${res.status}`);
  return res.text();
}

/** GET /space — storage summary */
export async function apiSpace(apiPort = 8080): Promise<SpaceInfo> {
  const res = await fetch(`${sidecarBase(apiPort)}/space`);
  if (!res.ok) throw new Error(`/space returned ${res.status}`);
  return res.json();
}

/** POST /data — upload a small test file, returns the CID (plain text). */
export async function apiUploadFile(
  content: string | Buffer,
  filename = 'e2e-test.txt',
  mime = 'text/plain',
  apiPort = 8080,
): Promise<string> {
  const body = typeof content === 'string' ? Buffer.from(content) : content;
  const res = await fetch(`${sidecarBase(apiPort)}/data`, {
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
export async function apiDeleteFile(cid: string, apiPort = 8080): Promise<void> {
  const res = await fetch(`${sidecarBase(apiPort)}/data/${cid}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE /data/${cid} returned ${res.status}`);
}

/** GET /data — list stored CIDs */
export async function apiListFiles(apiPort = 8080): Promise<{ content: Array<{ cid: string }> }> {
  const res = await fetch(`${sidecarBase(apiPort)}/data`);
  if (!res.ok) throw new Error(`GET /data returned ${res.status}`);
  return res.json();
}

/** POST /data/{cid}/network — request download from network */
export async function apiDownloadFromNetwork(cid: string, apiPort = 8080): Promise<void> {
  const res = await fetch(`${sidecarBase(apiPort)}/data/${cid}/network`, { method: 'POST' });
  if (!res.ok) throw new Error(`POST /data/${cid}/network returned ${res.status}`);
}

/** GET /connect/{peerId}?addrs[]= — connect to a peer */
export async function apiConnectPeer(
  peerId: string,
  addrs: string[] = [],
  apiPort = 8080,
): Promise<void> {
  const params = addrs.map((a) => `addrs[]=${encodeURIComponent(a)}`).join('&');
  const url = `${sidecarBase(apiPort)}/connect/${peerId}${params ? '?' + params : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET /connect/${peerId} returned ${res.status}`);
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
  errorBannerEnhanced: '.error-banner-enhanced',
  errorBannerAction: '.error-banner-action',

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

  // Web Archive
  webArchivePage: '.web-archive-page',
  webArchiveHeader: '.web-archive-page h1',
  archiveUrlInput: '.web-archive-page .url-input',
  archiveBtn: '.web-archive-page .archive-btn',
  archiveTaskCard: '.web-archive-page .task-card',
  archiveTaskBadge: '.web-archive-page .task-badge',
  archivedItem: '.web-archive-page .archived-item',
  browseBtn: '.web-archive-page .browse-btn',
  viewerPanel: '.web-archive-page .archive-viewer-panel',
  viewerIframe: '.web-archive-page .archive-viewer-iframe',
  viewerCloseBtn: '.web-archive-page .viewer-close-btn',

  // Chat
  chatPage: '.chat-page',
  chatHeading: '.chat-page h2',
  chatContainer: '.chat-container',
  chatSidebar: '.chat-sidebar',
  chatSidebarHeader: '.chat-sidebar-header',
  chatEmpty: '.chat-empty',
  conversationList: '.conversation-list',
  conversationItem: '.conversation-item',
  conversationItemActive: '.conversation-item.active',
  conversationName: '.conversation-name',
  conversationPreview: '.conversation-preview',
  unreadBadge: '.unread-badge',
  chatMain: '.chat-main',
  chatHeaderInfo: '.chat-header-info h3',
  chatMessages: '.chat-messages',
  message: '.message',
  messageOutgoing: '.message.outgoing',
  messageIncoming: '.message.incoming',
  messageText: '.message-text',
  messageReplyIndicator: '.message-reply-indicator',
  chatInput: '.chat-input',
  sendBtn: '.send-btn',
  chatEmptyState: '.chat-empty-state',
  replyPreview: '.reply-preview',
  replyCancelBtn: '.btn-reply-cancel',
  newGroupBtn: '.chat-sidebar-header .btn',
  safetyNumberModal: '.safety-number-modal',
  safetyNumberGrid: '.safety-number-grid',
  navChatBadge: '.nav-chat-badge',

  // Marketplace
  marketplacePage: '.marketplace-page',
  marketplaceHeader: '.marketplace-page h1',
  mpSection: '.mp-section',
  mpForm: '.mp-form',
  mpSubmitBtn: '.mp-submit-btn',
  mpTable: '.mp-table',
  mpStats: '.mp-stats',
  mpEmpty: '.mp-empty',
  mpSectionHeader: '.mp-section-header',
  mpRefreshBtn: '.mp-refresh-btn',

  // Deals
  dealsPage: '.deals-page',
  dealsHeader: '.deals-page h1',

  // Wallet
  walletPage: '.wallet-page',
  walletHeader: '.wallet-page h1',
  walletAddress: '.wallet-address',
  walletNetworkBadge: '.wallet-network-badge',
  walletContracts: '.wallet-contracts',
  walletContractRow: '.wallet-contract-row',

  // Torrents
  torrentsPage: '.torrents-page',
  torrentsHeader: '.torrents-page h1',
  magnetInput: '.add-torrent-bar input[type="text"]',
  addMagnetBtn: '.add-torrent-bar .add-magnet-btn',
  addFileBtn: '.add-torrent-bar .add-file-btn',
  torrentList: '.torrent-list',
  torrentRow: '.torrent-row',
  torrentRowSelected: '.torrent-row.selected',
  torrentName: '.torrent-name',
  torrentProgress: '.torrent-progress-bar',
  torrentProgressFill: '.torrent-progress-fill',
  torrentStateBadge: '.torrent-state-badge',
  torrentSpeedDl: '.torrent-speed-dl',
  torrentSpeedUl: '.torrent-speed-ul',
  torrentDetailPanel: '.torrent-detail-panel',
  detailTabFiles: '.detail-tabs [data-tab="files"]',
  detailTabPeers: '.detail-tabs [data-tab="peers"]',
  detailTabInfo: '.detail-tabs [data-tab="info"]',
  fileTree: '.file-tree',
  fileTreeItem: '.file-tree-item',
  fileCheckbox: '.file-tree-item input[type="checkbox"]',
  peerTable: '.peer-table',
  peerTableRow: '.peer-table tr',
  torrentInfoHash: '.torrent-info-hash',
  torrentStatusBar: '.torrent-status-bar',
  speedLimitDl: '.speed-limit-dl input',
  speedLimitUl: '.speed-limit-ul input',
  globalDlSpeed: '.global-stats .dl-speed',
  globalUlSpeed: '.global-stats .ul-speed',
  torrentContextMenu: '.torrent-context-menu',
  torrentPauseBtn: '.torrent-pause-btn',
  torrentResumeBtn: '.torrent-resume-btn',
  torrentRemoveBtn: '.torrent-remove-btn',
  torrentEmptyState: '.torrent-empty-state',

  // Media Player
  mediaPlayerPage: '.media-player-page',
  mediaPlayerVideo: '.media-player-page video',
  mediaPlayerBackBtn: '.media-player-page .back-btn',

  // Backup Server (container class is "backup-server", not "backup-server-page")
  backupServerPage: '.backup-server',
  backupServerHeader: '.backup-server h1',
  backupStatsCard: '.stat-card',
  backupStatsGrid: '.stats-grid',
  backupConfigGrid: '.config-grid',
  backupInfoBanner: '.info-banner',
  backupManifestTable: '.manifest-table',

  // Add Device (extra selectors for wizard states)
  wizardStep: '.wizard-step',
  wizardIconConnecting: '.wizard-icon.connecting',
  wizardIconSuccess: '.wizard-icon.success',
  wizardIconError: '.wizard-icon.error',

  // Media Player (extra selectors for controls)
  playerControls: '.player-controls',
  playBtn: '.play-btn',
  muteBtn: '.mute-btn',
  seekBar: '.seek-bar',
  volumeBar: '.volume-bar',
  playlistToggleBtn: '.playlist-toggle-btn',
  playlistSidebar: '.playlist-sidebar',
  playerBackBtn: '.player-back-btn',

  // Wallet (extra selectors)
  walletCopyBtn: '.wallet-copy-btn',

  // Dashboard - IRC chat
  ircChat: '.irc-chat',
  ircChannel: '.irc-channel',
  ircMessages: '.irc-messages',
  dashboardLayout: '.dashboard-layout',
  dashboardMain: '.dashboard-main',
} as const;

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/**
 * Direct-URL fallback map for pages that may not have sidebar links
 * (e.g. marketplace pages behind feature flags).
 */
const DIRECT_NAV_ROUTES: Record<string, string> = {
  'Dashboard': '/',
  'Make a Deal': '/marketplace',
  'My Deals': '/marketplace/deals',
  'Wallet': '/wallet',
  'Torrents': '/torrents',
  // Legacy labels (fallback for old tests not yet updated)
  'Browse': '/marketplace',
  'Restore': '/files',
  'Backups': '/sync',
  'Media Download': '/media',
  'Web Archive': '/web-archive',
  'Chat': '/chat',
  'Streaming TV': '/streaming',
};

/** Click a sidebar nav link by visible text, falling back to direct URL navigation. */
export async function navigateTo(page: Page, label: string): Promise<void> {
  // Expand the Advanced accordion if targeting Logs / Settings / Backup Server
  const advancedTargets = ['Logs', 'Backup Server', 'Settings', 'My Devices', 'Add Device', 'Folder Upload'];
  if (advancedTargets.includes(label)) {
    const accordion = page.locator('.sidebar .nav-accordion-header:has-text("Advanced")');
    const targetLink = page.locator(`.sidebar .nav-link:has-text("${label}")`);
    if (!(await targetLink.isVisible({ timeout: 1000 }).catch(() => false))) {
      await accordion.click();
      await page.waitForTimeout(500);
    }
  }

  // Check if sidebar link exists; if not, navigate directly via URL
  const sidebarLink = page.locator(`.sidebar .nav-link:has-text("${label}")`);
  const linkVisible = await sidebarLink.isVisible({ timeout: 2_000 }).catch(() => false);

  if (linkVisible) {
    await sidebarLink.click();
  } else if (DIRECT_NAV_ROUTES[label]) {
    // Page not in sidebar — use direct URL navigation
    const currentUrl = new URL(page.url());
    await page.goto(`${currentUrl.origin}${DIRECT_NAV_ROUTES[label]}`);
  } else {
    throw new Error(`Navigation target "${label}" not found in sidebar and no direct route configured`);
  }

  await page.waitForLoadState('domcontentloaded');
}

/**
 * Ensure the app is past onboarding (skip onboarding if it's showing).
 * Sets the localStorage key and reloads the page to land on the main app shell.
 */
export async function ensurePastOnboarding(page: Page): Promise<void> {
  const hasSidebar = await page.locator('.sidebar').isVisible({ timeout: 2_000 }).catch(() => false);
  if (hasSidebar) return; // Already past onboarding

  // Set onboarding as complete via localStorage and navigate to root
  await page.evaluate(() => {
    localStorage.setItem('archivist_onboarding_complete', 'true');
    localStorage.removeItem('archivist_onboarding_step');
  });

  // Navigate to root (more reliable than reload, especially if current page is broken)
  const currentUrl = new URL(page.url());
  await page.goto(`${currentUrl.origin}/`);
  await page.waitForLoadState('domcontentloaded');

  // Wait for sidebar to appear
  await page.locator('.sidebar').waitFor({ state: 'visible', timeout: 10_000 });
}

