import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../hooks/useDebrid', () => ({
  useDebrid: vi.fn(() => ({
    configured: true,
    providerType: 'real_debrid',
    loading: false,
    error: null,
    resolveStream: vi.fn(),
    checkCache: vi.fn().mockResolvedValue([
      { info_hash: 'abc123', is_cached: true },
    ]),
    configureRealDebrid: vi.fn(),
    configurePremiumize: vi.fn(),
    clearProvider: vi.fn(),
    validateToken: vi.fn(),
    refreshStatus: vi.fn(),
  })),
}));

import ContentDetail from '../pages/ContentDetail';

const mockInvoke = vi.mocked(invoke);

const mockMeta = {
  id: 'tt1234567',
  type: 'movie',
  name: 'Test Movie',
  poster: 'http://img.com/poster.jpg',
  background: 'http://img.com/bg.jpg',
  description: 'A great test movie about testing.',
  year: 2024,
  runtime: '120 min',
  imdbRating: '8.5',
  genres: ['Action', 'Drama'],
  cast: ['Actor One', 'Actor Two'],
};

const mockStreams = [
  {
    addon_name: 'Torrentio',
    stream: {
      name: '1080p',
      title: 'Test.Movie.2024.1080p.BluRay',
      infoHash: 'abc123',
      fileIdx: 0,
    },
  },
  {
    addon_name: 'Public Domain',
    stream: {
      name: 'Stream',
      title: 'Direct Link',
      url: 'http://example.com/movie.mp4',
    },
  },
];

function renderContentDetail(type = 'movie', id = 'tt1234567') {
  return render(
    <MemoryRouter initialEntries={[`/streaming/content/${type}/${id}`]}>
      <Routes>
        <Route path="/streaming/content/:type/:id" element={<ContentDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ContentDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show loading state initially', () => {
    // Never resolve - stays loading
    mockInvoke.mockReturnValue(new Promise(() => {}));
    renderContentDetail();
    expect(screen.getByText('Loading content details...')).toBeInTheDocument();
  });

  it('should render metadata', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_stremio_meta') return mockMeta;
      if (cmd === 'get_stremio_streams') return mockStreams;
      return null;
    });

    renderContentDetail();

    await waitFor(() => {
      expect(screen.getByText('Test Movie')).toBeInTheDocument();
    });

    expect(screen.getByText('A great test movie about testing.')).toBeInTheDocument();
    expect(screen.getByText('2024')).toBeInTheDocument();
    expect(screen.getByText('120 min')).toBeInTheDocument();
    expect(screen.getByText('IMDb 8.5')).toBeInTheDocument();
    expect(screen.getByText('Action')).toBeInTheDocument();
    expect(screen.getByText('Drama')).toBeInTheDocument();
  });

  it('should list streams', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_stremio_meta') return mockMeta;
      if (cmd === 'get_stremio_streams') return mockStreams;
      return null;
    });

    renderContentDetail();

    await waitFor(() => {
      expect(screen.getByText('Torrentio')).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(screen.getByText('Test.Movie.2024.1080p.BluRay')).toBeInTheDocument();
    expect(screen.getByText('Public Domain')).toBeInTheDocument();
  });

  it('should show cached badge for infoHash streams', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_stremio_meta') return mockMeta;
      if (cmd === 'get_stremio_streams') return mockStreams;
      return null;
    });

    renderContentDetail();

    await waitFor(() => {
      expect(screen.getByText('Cached')).toBeInTheDocument();
    });

    expect(screen.getByText('Direct')).toBeInTheDocument();
  });

  it('should show error state', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_stremio_meta') throw 'Content not found';
      return null;
    });

    renderContentDetail();

    await waitFor(() => {
      expect(screen.getByText('Content not found')).toBeInTheDocument();
    });

    expect(screen.getByText('Back')).toBeInTheDocument();
  });
});
