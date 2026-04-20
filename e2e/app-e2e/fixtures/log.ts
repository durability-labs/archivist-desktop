/**
 * Read the sidecar's node.log for E2E assertions on backend behavior.
 *
 * Tests use this to verify that clicking a button in the UI actually resulted
 * in the sidecar processing the request correctly — not just that the UI didn't
 * show an error.
 */
import * as fs from 'fs';

export interface LogTail {
  /** Returns bytes written to node.log since this tail was created. */
  readNew: () => string;
  /** Await until the log grows past the anchor point OR timeout, then return new bytes. */
  waitForNew: (predicate: (text: string) => boolean, timeoutMs?: number) => Promise<string>;
}

export function readNodeLog(logPath: string, anchorOffset: number): LogTail {
  const read = () => {
    if (!fs.existsSync(logPath)) return '';
    const stat = fs.statSync(logPath);
    if (stat.size <= anchorOffset) return '';
    const fd = fs.openSync(logPath, 'r');
    try {
      const buf = Buffer.alloc(stat.size - anchorOffset);
      fs.readSync(fd, buf, 0, buf.length, anchorOffset);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  };

  return {
    readNew: read,
    async waitForNew(predicate, timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const chunk = read();
        if (chunk && predicate(chunk)) return chunk;
        await new Promise((r) => setTimeout(r, 200));
      }
      return read();
    },
  };
}

/**
 * Assert no fatal sidecar errors appear in a log chunk.
 * Returns the matched error lines (empty array = all good).
 */
export function findFatalErrors(logChunk: string): string[] {
  const patterns = [
    /Unrecognized option/,
    /^\s*FATAL\s/m,
    /must be larger than zero/, // catches the 422 availability regression
    /Persistence is not enabled/, // only useful when caller has established marketplace should be active
  ];
  const lines = logChunk.split(/\r?\n/);
  const hits: string[] = [];
  for (const line of lines) {
    for (const p of patterns) {
      if (p.test(line)) {
        hits.push(line);
        break;
      }
    }
  }
  return hits;
}

/**
 * Looser variant — catches clear errors but allows "Persistence is not enabled"
 * (which is a legitimate response when the caller's wallet isn't unlocked yet).
 */
export function findHardFailures(logChunk: string): string[] {
  const patterns = [
    /Unrecognized option/,
    /^\s*FATAL\s/m,
    /must be larger than zero/,
  ];
  const lines = logChunk.split(/\r?\n/);
  const hits: string[] = [];
  for (const line of lines) {
    for (const p of patterns) {
      if (p.test(line)) {
        hits.push(line);
        break;
      }
    }
  }
  return hits;
}
