import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---- Mocks ----

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...(args as [string, ...unknown[]])),
}));

// Store event listener callbacks for manual triggering
const eventListeners: Record<string, Function> = {};
const mockListen = vi.fn((event: string, cb: Function) => {
  eventListeners[event] = cb;
  return Promise.resolve(() => {
    delete eventListeners[event];
  });
});
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...(args as [string, Function])),
}));

// ---- Import after mocks ----
import { useMediaDownload } from '../hooks/useMediaDownload';
import type { DownloadQueueState, BinaryStatus } from '../hooks/useMediaDownload';

// ---- Test data ----

const mockQueueState: DownloadQueueState = {
  tasks: [
    {
      id: 'task-1',
      url: 'https://example.com/video',
      title: 'Test Video',
      thumbnail: null,
      state: 'downloading',
      progressPercent: 25.0,
      downloadedBytes: 1024,
      totalBytes: 4096,
      speed: '1.0MB/s',
      eta: '00:03',
      outputPath: null,
      error: null,
      createdAt: '2024-01-01T00:00:00Z',
      completedAt: null,
      options: {
        url: 'https://example.com/video',
        formatId: '22',
        audioOnly: false,
        audioFormat: null,
        outputDirectory: '/tmp',
        filename: null,
      },
    },
  ],
  activeCount: 1,
  queuedCount: 0,
  completedCount: 0,
  maxConcurrent: 3,
  ytDlpAvailable: true,
  ffmpegAvailable: true,
  ytDlpVersion: '2024.01.01',
};

const mockBinaryStatus: BinaryStatus = {
  ytDlpInstalled: true,
  ytDlpVersion: '2024.01.01',
  ytDlpPath: '/usr/bin/yt-dlp',
  ffmpegInstalled: true,
  ffmpegVersion: '6.0',
  ffmpegPath: '/usr/bin/ffmpeg',
};

describe('useMediaDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear event listeners
    Object.keys(eventListeners).forEach((key) => delete eventListeners[key]);

    // Default invoke responses
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case 'get_download_queue':
          return Promise.resolve(mockQueueState);
        case 'check_media_binaries':
          return Promise.resolve(mockBinaryStatus);
        default:
          return Promise.resolve(null);
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Initialization
  // =========================================================================

  it('calls get_download_queue and check_media_binaries on mount', async () => {
    renderHook(() => useMediaDownload());

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_download_queue');
      expect(mockInvoke).toHaveBeenCalledWith('check_media_binaries');
    });
  });

  it('sets loading to false after initialization', async () => {
    const { result } = renderHook(() => useMediaDownload());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it('sets queueState from invoke response', async () => {
    const { result } = renderHook(() => useMediaDownload());

    await waitFor(() => {
      expect(result.current.queueState).not.toBeNull();
      expect(result.current.queueState?.tasks.length).toBe(1);
      expect(result.current.queueState?.tasks[0].title).toBe('Test Video');
    });
  });

  it('sets binaryStatus from invoke response', async () => {
    const { result } = renderHook(() => useMediaDownload());

    await waitFor(() => {
      expect(result.current.binaryStatus).not.toBeNull();
      expect(result.current.binaryStatus?.ytDlpInstalled).toBe(true);
      expect(result.current.binaryStatus?.ytDlpVersion).toBe('2024.01.01');
    });
  });

  // =========================================================================
  // Polling
  // =========================================================================

  it('polls queue every 2 seconds', async () => {
    vi.useFakeTimers();

    renderHook(() => useMediaDownload());

    // Wait for initial calls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const initialCallCount = mockInvoke.mock.calls.filter(
      (c) => c[0] === 'get_download_queue'
    ).length;

    // Advance 2 seconds for next poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    const newCallCount = mockInvoke.mock.calls.filter(
      (c) => c[0] === 'get_download_queue'
    ).length;

    expect(newCallCount).toBeGreaterThan(initialCallCount);

    vi.useRealTimers();
  });

  // =========================================================================
  // Event listeners
  // =========================================================================

  it('registers media-download-progress event listener', async () => {
    renderHook(() => useMediaDownload());

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalledWith(
        'media-download-progress',
        expect.any(Function)
      );
    });
  });

  it('registers media-download-state-changed event listener', async () => {
    renderHook(() => useMediaDownload());

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalledWith(
        'media-download-state-changed',
        expect.any(Function)
      );
    });
  });

  // =========================================================================
  // Action callbacks
  // =========================================================================

  it('fetchMetadata invokes correct command', async () => {
    const { result } = renderHook(() => useMediaDownload());

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.fetchMetadata('https://example.com/video');
    });

    expect(mockInvoke).toHaveBeenCalledWith('fetch_media_metadata', {
      url: 'https://example.com/video',
    });
  });

  it('queueDownload invokes and refreshes queue', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case 'get_download_queue':
          return Promise.resolve(mockQueueState);
        case 'check_media_binaries':
          return Promise.resolve(mockBinaryStatus);
        case 'queue_media_download':
          return Promise.resolve('new-task-id');
        default:
          return Promise.resolve(null);
      }
    });

    const { result } = renderHook(() => useMediaDownload());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const options = {
      url: 'https://example.com',
      formatId: '22',
      audioOnly: false,
      audioFormat: null,
      outputDirectory: '/tmp',
      filename: null,
    };

    await act(async () => {
      await result.current.queueDownload(options, 'Test', null);
    });

    expect(mockInvoke).toHaveBeenCalledWith('queue_media_download', {
      options,
      title: 'Test',
      thumbnail: null,
    });

    // Should also refresh queue after queueing
    const queueCalls = mockInvoke.mock.calls.filter(
      (c) => c[0] === 'get_download_queue'
    );
    expect(queueCalls.length).toBeGreaterThanOrEqual(2); // init + after queue
  });

  it('installYtDlp sets and clears installingBinary', async () => {
    let resolveInstall: () => void;
    mockInvoke.mockImplementation((cmd: string) => {
      switch (cmd) {
        case 'get_download_queue':
          return Promise.resolve(mockQueueState);
        case 'check_media_binaries':
          return Promise.resolve(mockBinaryStatus);
        case 'install_yt_dlp':
          return new Promise<void>((resolve) => {
            resolveInstall = resolve;
          });
        default:
          return Promise.resolve(null);
      }
    });

    const { result } = renderHook(() => useMediaDownload());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Start installation (don't await yet)
    let installPromise: Promise<void>;
    act(() => {
      installPromise = result.current.installYtDlp();
    });

    // During installation, installingBinary should be set
    expect(result.current.installingBinary).toBe('yt-dlp');

    // Resolve the install
    await act(async () => {
      resolveInstall!();
      await installPromise!;
    });

    // After installation, should be cleared
    expect(result.current.installingBinary).toBeNull();
  });
});
