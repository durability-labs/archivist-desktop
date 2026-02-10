import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MediaDownload from '../pages/MediaDownload';
import { useMediaDownload } from '../hooks/useMediaDownload';
import type { DownloadQueueState, BinaryStatus, DownloadTask } from '../hooks/useMediaDownload';

// Mock the useMediaDownload hook
vi.mock('../hooks/useMediaDownload', () => ({
  useMediaDownload: vi.fn(),
}));

// Mock @tauri-apps/api/path
vi.mock('@tauri-apps/api/path', () => ({
  downloadDir: vi.fn(() => Promise.resolve('/home/test/Downloads')),
}));

// Helper to create a default mock return for useMediaDownload
function mockHookReturn(overrides: Partial<ReturnType<typeof useMediaDownload>> = {}) {
  const defaultQueue: DownloadQueueState = {
    tasks: [],
    activeCount: 0,
    queuedCount: 0,
    completedCount: 0,
    maxConcurrent: 3,
    ytDlpAvailable: true,
    ffmpegAvailable: true,
    ytDlpVersion: '2024.01.01',
  };

  const defaultBinary: BinaryStatus = {
    ytDlpInstalled: true,
    ytDlpVersion: '2024.01.01',
    ytDlpPath: '/usr/bin/yt-dlp',
    ffmpegInstalled: true,
    ffmpegVersion: '6.0',
    ffmpegPath: '/usr/bin/ffmpeg',
  };

  const defaults: ReturnType<typeof useMediaDownload> = {
    queueState: defaultQueue,
    binaryStatus: defaultBinary,
    loading: false,
    error: null,
    installingBinary: null,
    fetchMetadata: vi.fn(),
    queueDownload: vi.fn(),
    cancelDownload: vi.fn(),
    removeTask: vi.fn(),
    clearCompleted: vi.fn(),
    installYtDlp: vi.fn(),
    installFfmpeg: vi.fn(),
    updateYtDlp: vi.fn(),
    checkBinaries: vi.fn(),
    refreshQueue: vi.fn(),
  };

  const merged = { ...defaults, ...overrides };
  vi.mocked(useMediaDownload).mockReturnValue(merged);
  return merged;
}

describe('MediaDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Loading state
  // =========================================================================

  it('renders loading state', () => {
    mockHookReturn({ loading: true });
    render(<MediaDownload />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  // =========================================================================
  // Setup banners
  // =========================================================================

  it('renders setup banner when yt-dlp is not installed', () => {
    mockHookReturn({
      binaryStatus: {
        ytDlpInstalled: false,
        ytDlpVersion: null,
        ytDlpPath: null,
        ffmpegInstalled: false,
        ffmpegVersion: null,
        ffmpegPath: null,
      },
    });
    render(<MediaDownload />);
    expect(screen.getByText('Setup Required')).toBeInTheDocument();
    expect(screen.getByText('Install yt-dlp')).toBeInTheDocument();
  });

  it('renders ffmpeg recommendation when yt-dlp installed but ffmpeg missing', () => {
    mockHookReturn({
      binaryStatus: {
        ytDlpInstalled: true,
        ytDlpVersion: '2024.01.01',
        ytDlpPath: '/usr/bin/yt-dlp',
        ffmpegInstalled: false,
        ffmpegVersion: null,
        ffmpegPath: null,
      },
    });
    render(<MediaDownload />);
    expect(screen.getByText('Recommended: Install ffmpeg')).toBeInTheDocument();
    expect(screen.getByText('Install ffmpeg')).toBeInTheDocument();
  });

  it('renders version info when both binaries installed', () => {
    mockHookReturn(); // defaults have both installed
    render(<MediaDownload />);
    expect(screen.getByText(/yt-dlp 2024\.01\.01/)).toBeInTheDocument();
    expect(screen.getByText(/ffmpeg 6\.0/)).toBeInTheDocument();
  });

  it('calls installYtDlp when Install button is clicked', async () => {
    const mocks = mockHookReturn({
      binaryStatus: {
        ytDlpInstalled: false,
        ytDlpVersion: null,
        ytDlpPath: null,
        ffmpegInstalled: false,
        ffmpegVersion: null,
        ffmpegPath: null,
      },
    });
    render(<MediaDownload />);
    const btn = screen.getByText('Install yt-dlp');
    await userEvent.click(btn);
    expect(mocks.installYtDlp).toHaveBeenCalledOnce();
  });

  // =========================================================================
  // URL input
  // =========================================================================

  it('URL input is disabled when yt-dlp is not installed', () => {
    mockHookReturn({
      binaryStatus: {
        ytDlpInstalled: false,
        ytDlpVersion: null,
        ytDlpPath: null,
        ffmpegInstalled: false,
        ffmpegVersion: null,
        ffmpegPath: null,
      },
    });
    render(<MediaDownload />);
    const input = screen.getByPlaceholderText(/youtube\.com/i);
    expect(input).toBeDisabled();
  });

  it('Fetch Info button calls fetchMetadata with URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      title: 'Test',
      url: 'https://example.com',
      thumbnail: null,
      durationSeconds: null,
      uploader: null,
      description: null,
      formats: [],
    });
    mockHookReturn({ fetchMetadata: mockFetch });

    render(<MediaDownload />);
    const input = screen.getByPlaceholderText(/youtube\.com/i);
    await userEvent.type(input, 'https://www.youtube.com/watch?v=test123');
    const fetchBtn = screen.getByText('Fetch Info');
    await userEvent.click(fetchBtn);
    expect(mockFetch).toHaveBeenCalledWith('https://www.youtube.com/watch?v=test123');
  });

  // =========================================================================
  // Download queue
  // =========================================================================

  it('shows empty queue placeholder text', () => {
    mockHookReturn({ queueState: { tasks: [], activeCount: 0, queuedCount: 0, completedCount: 0, maxConcurrent: 3, ytDlpAvailable: true, ffmpegAvailable: true, ytDlpVersion: null } });
    render(<MediaDownload />);
    expect(screen.getByText(/No downloads yet/)).toBeInTheDocument();
  });

  it('renders task with progress bar when downloading', () => {
    const task: DownloadTask = {
      id: 'task-1',
      url: 'https://example.com',
      title: 'Downloading Video',
      thumbnail: null,
      state: 'downloading',
      progressPercent: 50.0,
      downloadedBytes: 0,
      totalBytes: null,
      speed: '5.2MB/s',
      eta: '00:30',
      outputPath: null,
      error: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      options: { url: 'https://example.com', formatId: null, audioOnly: false, audioFormat: null, outputDirectory: '/tmp', filename: null },
    };
    mockHookReturn({
      queueState: {
        tasks: [task],
        activeCount: 1,
        queuedCount: 0,
        completedCount: 0,
        maxConcurrent: 3,
        ytDlpAvailable: true,
        ffmpegAvailable: true,
        ytDlpVersion: null,
      },
    });
    render(<MediaDownload />);
    expect(screen.getByText('Downloading Video')).toBeInTheDocument();
    expect(screen.getByText('downloading')).toBeInTheDocument();
    expect(screen.getByText('50.0%')).toBeInTheDocument();
    expect(screen.getByText('5.2MB/s')).toBeInTheDocument();
  });

  it('renders completed task with remove button', () => {
    const task: DownloadTask = {
      id: 'task-2',
      url: 'https://example.com',
      title: 'Finished Video',
      thumbnail: null,
      state: 'completed',
      progressPercent: 100,
      downloadedBytes: 0,
      totalBytes: null,
      speed: null,
      eta: null,
      outputPath: '/tmp/video.mp4',
      error: null,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      options: { url: 'https://example.com', formatId: null, audioOnly: false, audioFormat: null, outputDirectory: '/tmp', filename: null },
    };
    mockHookReturn({
      queueState: {
        tasks: [task],
        activeCount: 0,
        queuedCount: 0,
        completedCount: 1,
        maxConcurrent: 3,
        ytDlpAvailable: true,
        ffmpegAvailable: true,
        ytDlpVersion: null,
      },
    });
    render(<MediaDownload />);
    expect(screen.getByText('Finished Video')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    // Clear completed button should be visible
    expect(screen.getByText('Clear completed')).toBeInTheDocument();
  });

  it('renders page header', () => {
    mockHookReturn();
    render(<MediaDownload />);
    expect(screen.getByText('Media Download')).toBeInTheDocument();
  });

  it('shows Downloads heading', () => {
    mockHookReturn();
    render(<MediaDownload />);
    expect(screen.getByText('Downloads')).toBeInTheDocument();
  });
});
