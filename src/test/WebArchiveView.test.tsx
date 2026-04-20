/**
 * Regression tests for the "View" button on scraped archives.
 *
 * Before a local archive has been uploaded to the node (no CID yet) the user
 * still needs a way to open the scraped site in the built-in viewer. This is
 * served from the local ZIP via the new `open_archive_viewer_local` command.
 * The View button must appear ABOVE the "Upload to Node" button in both the
 * Archive Queue task card and the Archived Sites list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import WebArchive from '../pages/WebArchive';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const mockedInvoke = vi.mocked(invoke);

function queueState(overrides: Record<string, unknown> = {}) {
  return {
    tasks: [],
    archivedSites: [],
    ...overrides,
  };
}

function completedLocalTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    url: 'https://example.com/foo',
    title: 'Example',
    state: 'completed',
    pagesDownloaded: 5,
    pagesFound: 5,
    assetsDownloaded: 12,
    totalBytes: 123456,
    bytesPerSecond: 0,
    etaSeconds: null,
    localPath: 'C:\\users\\test\\archives\\archive-task-1.zip',
    cid: null,
    error: null,
    options: { url: 'https://example.com/foo' },
    ...overrides,
  };
}

function archivedLocalSite(overrides: Record<string, unknown> = {}) {
  return {
    url: 'https://example.com/foo',
    title: 'Example',
    pagesCount: 5,
    assetsCount: 12,
    totalBytes: 123456,
    localPath: 'C:\\users\\test\\archives\\archive-task-1.zip',
    cid: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WebArchive — View button for local (not-yet-uploaded) archives', () => {
  it('renders a "View" button above "Upload to Node" in the Archived Sites list', async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_archive_queue') {
        return Promise.resolve(queueState({ archivedSites: [archivedLocalSite()] }));
      }
      return Promise.resolve(undefined);
    });

    render(<WebArchive />);

    // Wait for load
    await act(async () => {
      await Promise.resolve();
    });

    const viewBtn = await screen.findByRole('button', { name: /^View$/ });
    const uploadBtn = await screen.findByRole('button', { name: /Upload to Node/i });

    expect(viewBtn).toBeInTheDocument();
    expect(uploadBtn).toBeInTheDocument();

    // DOM ordering: View must come before Upload to Node.
    expect(
      viewBtn.compareDocumentPosition(uploadBtn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('clicking View invokes open_archive_viewer_local with the local ZIP path', async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_archive_queue') {
        return Promise.resolve(queueState({ archivedSites: [archivedLocalSite()] }));
      }
      if (cmd === 'open_archive_viewer_local') {
        return Promise.resolve('http://127.0.0.1:8088/');
      }
      return Promise.resolve(undefined);
    });

    render(<WebArchive />);
    await act(async () => {
      await Promise.resolve();
    });

    const viewBtn = await screen.findByRole('button', { name: /^View$/ });
    await userEvent.click(viewBtn);

    const call = mockedInvoke.mock.calls.find(([cmd]) => cmd === 'open_archive_viewer_local');
    expect(call, 'expected open_archive_viewer_local to be invoked').toBeTruthy();
    const payload = call![1] as Record<string, unknown>;
    expect(payload.localPath).toBe('C:\\users\\test\\archives\\archive-task-1.zip');
    expect(payload.url).toBe('https://example.com/foo');
  });

  it('renders a "View" button on a completed task card with localPath but no CID', async () => {
    mockedInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_archive_queue') {
        return Promise.resolve(queueState({ tasks: [completedLocalTask()] }));
      }
      return Promise.resolve(undefined);
    });

    render(<WebArchive />);
    await act(async () => {
      await Promise.resolve();
    });

    // The task card should expose a View button (not only after upload/CID).
    expect(await screen.findByRole('button', { name: /^View$/ })).toBeInTheDocument();
  });
});
