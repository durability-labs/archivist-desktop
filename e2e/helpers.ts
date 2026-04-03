// ---------------------------------------------------------------------------
// WebdriverIO helper utilities for Archivist Desktop E2E tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Wait helpers
// ---------------------------------------------------------------------------

/**
 * Wait until a TCP port is accepting connections (polls every 500 ms).
 * Useful for waiting on the sidecar API (8080).
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
    body: body as unknown as BodyInit,
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
// Common CSS selectors & navigation routes (shared with Playwright tests)
// ---------------------------------------------------------------------------

export { SEL, DIRECT_NAV_ROUTES } from './selectors';
import { SEL, DIRECT_NAV_ROUTES } from './selectors';

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/**
 * Find an element matching a CSS selector that contains the given text.
 * Returns a WebdriverIO element. Uses XPath under the hood.
 *
 * Example: `await hasText('.nav-link', 'Dashboard')` → finds `.nav-link` containing "Dashboard"
 */
export async function hasText(cssSelector: string, text: string) {
  // Convert simple CSS class/tag selectors to XPath
  const xpath = cssToXPathContainsText(cssSelector, text);
  return $(xpath);
}

/**
 * Find all elements matching a CSS selector that contain the given text.
 */
export async function allHasText(cssSelector: string, text: string) {
  const xpath = cssToXPathContainsText(cssSelector, text);
  return $$(xpath);
}

/**
 * Find a child element within a parent that contains text.
 * Example: `hasTextChild('.setting-item', 'API Port', 'input[type="number"]')`
 */
export async function hasTextChild(
  parentCss: string,
  text: string,
  childCss: string,
) {
  // Find parent with text, then locate child within it
  const parent = await hasText(parentCss, text);
  return parent.$(childCss);
}

/**
 * Convert a simple CSS selector + text to an XPath expression.
 * Handles: `.class`, `tag`, `tag.class`, `.class1.class2`, `#id`
 * with `[contains(., 'text')]`.
 */
function cssToXPathContainsText(css: string, text: string): string {
  // Escape single quotes in text for XPath
  const escapedText = text.includes("'")
    ? `concat('${text.split("'").join("', \"'\", '")}')`
    : `'${text}'`;

  const parts = parseCssToXPath(css);
  return `${parts}[contains(., ${escapedText})]`;
}

/**
 * Convert a basic CSS selector to an XPath expression (without text predicate).
 * Supports: tag, .class, tag.class, .class1.class2, #id, tag#id,
 * and descendant combinators (space-separated).
 */
function parseCssToXPath(css: string): string {
  // Handle descendant combinator (space-separated parts)
  const parts = css.trim().split(/\s+/);
  if (parts.length > 1) {
    return parts.map((p, i) => {
      const prefix = i === 0 ? '//' : '//';
      return parseSingleSelector(p, prefix);
    }).join('');
  }
  return parseSingleSelector(css, '//');
}

function parseSingleSelector(css: string, prefix: string): string {
  let tag = '*';
  let conditions: string[] = [];

  let remaining = css;

  // Extract tag name (before first . or #)
  const tagMatch = remaining.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
  if (tagMatch) {
    tag = tagMatch[1];
    remaining = remaining.slice(tagMatch[0].length);
  }

  // Extract #id
  const idMatch = remaining.match(/#([a-zA-Z0-9_-]+)/);
  if (idMatch) {
    conditions.push(`@id='${idMatch[1]}'`);
    remaining = remaining.replace(idMatch[0], '');
  }

  // Extract .classes
  const classMatches = remaining.matchAll(/\.([a-zA-Z0-9_-]+)/g);
  for (const m of classMatches) {
    conditions.push(`contains(@class, '${m[1]}')`);
  }

  // Extract [attr] and [attr="val"]
  const attrMatches = remaining.matchAll(/\[([^\]]+)\]/g);
  for (const m of attrMatches) {
    const attr = m[1];
    const eqMatch = attr.match(/^([^=~|^$*]+)=["']([^"']*)["']$/);
    if (eqMatch) {
      conditions.push(`@${eqMatch[1]}='${eqMatch[2]}'`);
    } else if (attr.match(/^[a-zA-Z-]+$/)) {
      conditions.push(`@${attr}`);
    } else {
      // Pass through complex attribute selectors
      conditions.push(`@${attr}`);
    }
  }

  // Extract :first-child, :last-child, :not(...) pseudo-classes
  // These are complex in XPath; handle common ones
  if (remaining.includes(':first-child')) {
    conditions.push('position()=1');
  }
  if (remaining.includes(':last-child')) {
    conditions.push('position()=last()');
  }
  const notMatch = remaining.match(/:not\(\.([a-zA-Z0-9_-]+)\)/);
  if (notMatch) {
    conditions.push(`not(contains(@class, '${notMatch[1]}'))`);
  }

  const condStr = conditions.length > 0 ? `[${conditions.join(' and ')}]` : '';
  return `${prefix}${tag}${condStr}`;
}

/**
 * Click a sidebar nav link by visible text, falling back to direct URL navigation.
 * Uses WebdriverIO globals (browser, $).
 */
export async function navigateTo(label: string): Promise<void> {
  // Expand the Advanced accordion if targeting items inside it
  const advancedTargets = ['Logs', 'Backup Server', 'Settings', 'My Devices', 'Add Device', 'Folder Upload'];
  if (advancedTargets.includes(label)) {
    const targetLink = await hasText('.sidebar .nav-link', label);
    const isDisplayed = await targetLink.isDisplayed().catch(() => false);

    if (!isDisplayed) {
      const accordion = await hasText('.sidebar .nav-accordion-header', 'Advanced');
      const accordionExists = await accordion.isDisplayed().catch(() => false);
      if (accordionExists) {
        await accordion.click();
        await browser.pause(500);
      }
    }
  }

  // Try sidebar link first
  const sidebarLink = await hasText('.sidebar .nav-link', label);
  const linkVisible = await sidebarLink.isDisplayed().catch(() => false);

  if (linkVisible) {
    await sidebarLink.click();
  } else if (DIRECT_NAV_ROUTES[label]) {
    await browser.url(DIRECT_NAV_ROUTES[label]);
  } else {
    throw new Error(`Navigation target "${label}" not found in sidebar and no direct route configured`);
  }

  // Brief pause for SPA navigation
  await browser.pause(300);
}

/**
 * Ensure the app is past onboarding.
 * Sets the localStorage key and reloads to land on the main app shell.
 */
export async function ensurePastOnboarding(): Promise<void> {
  const sidebar = await $(SEL.sidebar);
  const hasSidebar = await sidebar.isDisplayed().catch(() => false);
  if (hasSidebar) return;

  // Retry localStorage access — may fail if page hasn't loaded yet
  for (let i = 0; i < 10; i++) {
    try {
      await browser.execute(() => {
        localStorage.setItem('archivist_onboarding_complete', 'true');
        localStorage.removeItem('archivist_onboarding_step');
      });
      break;
    } catch {
      await sleep(1000);
    }
  }

  await browser.url('/');
  await sleep(1000);
  const sb = await $(SEL.sidebar);
  await sb.waitForDisplayed({ timeout: 15000 });
}

/**
 * Check if an element is displayed, with a timeout.
 * Returns true/false without throwing.
 */
export async function isDisplayed(selector: string, timeout = 2000): Promise<boolean> {
  try {
    const el = await $(selector);
    await el.waitForDisplayed({ timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if an element found by hasText is displayed, with a timeout.
 */
export async function isDisplayedWithText(cssSelector: string, text: string, timeout = 2000): Promise<boolean> {
  try {
    const el = await hasText(cssSelector, text);
    await el.waitForDisplayed({ timeout });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get count of elements matching a CSS selector.
 */
export async function getCount(selector: string): Promise<number> {
  const elements = await $$(selector);
  return elements.length;
}

/**
 * Accept a browser alert/confirm dialog.
 * Call this BEFORE the action that triggers the dialog.
 */
export async function acceptNextDialog(): Promise<void> {
  // WebdriverIO handles alerts differently — we need to accept after it appears
  // Use a short delay pattern
}

/**
 * Wait for an alert and accept it.
 */
export async function waitAndAcceptAlert(timeout = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await browser.acceptAlert();
      return;
    } catch {
      await sleep(200);
    }
  }
}
