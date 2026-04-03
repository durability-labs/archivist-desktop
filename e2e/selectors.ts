// ---------------------------------------------------------------------------
// Shared CSS selectors and navigation routes for E2E tests.
// Used by both WebDriverIO (e2e/helpers.ts) and Playwright (e2e/playwright/).
// No framework-specific imports — pure string constants only.
// ---------------------------------------------------------------------------

export const SEL = {
  // Onboarding
  splashScreen: '.splash-screen',
  splashSkip: '.splash-skip',
  welcomeScreen: '.welcome-screen',
  getStarted: '.btn-primary.btn-large',
  skipForNow: '.btn-text',
  nodeStartingScreen: '.node-starting-screen',
  nodeStatusReady: '.status-icon.ready',
  folderSelectScreen: '.folder-select-screen',
  quickBackupBtn: '.folder-option.recommended',
  chooseFolderBtn: '.folder-option:not(.recommended)',
  syncingScreen: '.syncing-screen',
  continueBtn: '.sync-complete-message .btn-primary.btn-large',

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
  logLine: '.log-line',
  errorMessage: '.logs-container .error-message',

  // Settings
  settingsHeader: '.page-header h2',
  saveBtn: '.actions button:last-child',
  resetBtn: '.actions button.secondary',
  successBanner: '.success-banner',
  settingsSection: '.settings-section',
  apiPortInput: 'input[type="number"]',
  errorBanner: '.error-banner',
  errorBannerEnhanced: '.error-banner-enhanced',
  errorBannerAction: '.error-banner-action',

  // Devices
  devicesPage: '.devices-page',
  thisDevice: '.this-device',
  peerIdCopyBtn: '.btn-small',
  sprCopyBtn: '.btn-small.secondary',
  deviceBadgeOnline: '.device-badge.online',
  deviceBadgeOffline: '.device-badge.offline',

  // Add Device
  addDevicePage: '.add-device-page',
  peerAddressInput: '#peer-address',
  connectBtn: '.primary',
  wizardError: '.wizard-error',
  wizardStep: '.wizard-step',
  wizardIconConnecting: '.wizard-icon.connecting',
  wizardIconSuccess: '.wizard-icon.success',
  wizardIconError: '.wizard-icon.error',

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
  walletCopyBtn: '.wallet-copy-btn',

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
  playerControls: '.player-controls',
  playBtn: '.play-btn',
  muteBtn: '.mute-btn',
  seekBar: '.seek-bar',
  volumeBar: '.volume-bar',
  playlistToggleBtn: '.playlist-toggle-btn',
  playlistSidebar: '.playlist-sidebar',
  playerBackBtn: '.player-back-btn',

  // Backup Server
  backupServerPage: '.backup-server',
  backupServerHeader: '.backup-server h1',
  backupStatsCard: '.stat-card',
  backupStatsGrid: '.stats-grid',
  backupConfigGrid: '.config-grid',
  backupInfoBanner: '.info-banner',
  backupManifestTable: '.manifest-table',

  // Dashboard - IRC chat
  ircChat: '.irc-chat',
  ircChannel: '.irc-channel',
  ircMessages: '.irc-messages',
  dashboardLayout: '.dashboard-layout',
  dashboardMain: '.dashboard-main',
} as const;

/**
 * Direct-URL fallback map for pages that may not have sidebar links
 * (e.g. marketplace pages behind feature flags).
 */
export const DIRECT_NAV_ROUTES: Record<string, string> = {
  'Dashboard': '/',
  'Make a Deal': '/marketplace',
  'My Deals': '/marketplace/deals',
  'Wallet': '/wallet',
  'Torrents': '/torrents',
  'Browse': '/marketplace',
  'Restore': '/files',
  'Backups': '/sync',
  'Media Download': '/media',
  'Web Archive': '/web-archive',
  'Chat': '/chat',
  'Streaming TV': '/streaming',
};
