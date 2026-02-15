import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

// Mock the hooks
vi.mock('../hooks/useStremioAddons', () => ({
  useStremioAddons: vi.fn(() => ({
    addons: [],
    loading: false,
    error: null,
    installAddon: vi.fn(),
    removeAddon: vi.fn(),
    toggleAddon: vi.fn(),
    refreshAddons: vi.fn(),
  })),
}));

vi.mock('../hooks/useCatalog', () => ({
  useCatalog: vi.fn(() => ({
    items: [],
    loading: false,
    error: null,
    hasMore: false,
    selectedType: 'movie',
    loadCatalog: vi.fn(),
    loadMore: vi.fn(),
    search: vi.fn(),
    clearItems: vi.fn(),
    setSelectedType: vi.fn(),
  })),
}));

vi.mock('../hooks/useDebrid', () => ({
  useDebrid: vi.fn(() => ({
    configured: false,
    providerType: null,
    loading: false,
    error: null,
    configureRealDebrid: vi.fn(),
    configurePremiumize: vi.fn(),
    clearProvider: vi.fn(),
    validateToken: vi.fn(),
    resolveStream: vi.fn(),
    checkCache: vi.fn(),
    refreshStatus: vi.fn(),
  })),
}));

vi.mock('../hooks/useIPTV', () => ({
  useIPTV: vi.fn(() => ({
    playlists: [],
    channels: [],
    selectedPlaylist: null,
    selectedGroup: null,
    loading: false,
    error: null,
    addPlaylist: vi.fn(),
    addPlaylistContent: vi.fn(),
    removePlaylist: vi.fn(),
    refreshPlaylist: vi.fn(),
    getChannels: vi.fn(),
    selectGroup: vi.fn(),
    searchChannels: vi.fn(),
    refreshPlaylists: vi.fn(),
  })),
}));

import Streaming from '../pages/Streaming';

function renderWithRouter(component: React.ReactElement) {
  return render(
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      {component}
    </BrowserRouter>
  );
}

describe('Streaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render with tabs', () => {
    renderWithRouter(<Streaming />);
    expect(screen.getByText('Streaming TV')).toBeInTheDocument();
    expect(screen.getByText('Discover')).toBeInTheDocument();
    expect(screen.getByText('IPTV')).toBeInTheDocument();
    expect(screen.getByText('Addons')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('should default to Discover tab active', () => {
    renderWithRouter(<Streaming />);
    const discoverBtn = screen.getByText('Discover');
    expect(discoverBtn.classList.contains('active')).toBe(true);
  });

  it('should switch tabs', () => {
    renderWithRouter(<Streaming />);

    fireEvent.click(screen.getByText('IPTV'));
    expect(screen.getByText('IPTV').classList.contains('active')).toBe(true);

    fireEvent.click(screen.getByText('Addons'));
    expect(screen.getByText('Addons').classList.contains('active')).toBe(true);

    fireEvent.click(screen.getByText('Settings'));
    expect(screen.getByText('Settings').classList.contains('active')).toBe(true);
  });

  it('should show empty state on Discover when no addons installed', () => {
    renderWithRouter(<Streaming />);
    expect(screen.getByText('No Content Available')).toBeInTheDocument();
    expect(screen.getByText(/Install Stremio-compatible addons/)).toBeInTheDocument();
  });

  it('should show debrid settings on Settings tab', () => {
    renderWithRouter(<Streaming />);
    fireEvent.click(screen.getByText('Settings'));
    expect(screen.getByText('Debrid Service')).toBeInTheDocument();
  });
});
