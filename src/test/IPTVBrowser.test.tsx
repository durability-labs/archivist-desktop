import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

const mockGetChannels = vi.fn();
const mockAddPlaylist = vi.fn();
const mockRemovePlaylist = vi.fn();
const mockRefreshPlaylist = vi.fn();
const mockSelectGroup = vi.fn();
const mockSearchChannels = vi.fn();

vi.mock('../hooks/useIPTV', () => ({
  useIPTV: vi.fn(() => ({
    playlists: [],
    channels: [],
    selectedPlaylist: null,
    selectedGroup: null,
    loading: false,
    error: null,
    addPlaylist: mockAddPlaylist,
    addPlaylistContent: vi.fn(),
    removePlaylist: mockRemovePlaylist,
    refreshPlaylist: mockRefreshPlaylist,
    getChannels: mockGetChannels,
    selectGroup: mockSelectGroup,
    searchChannels: mockSearchChannels,
    refreshPlaylists: vi.fn(),
  })),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import IPTVBrowser from '../pages/IPTVBrowser';
import { useIPTV } from '../hooks/useIPTV';

const mockUseIPTV = vi.mocked(useIPTV);

function renderComponent() {
  return render(
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <IPTVBrowser />
    </BrowserRouter>
  );
}

describe('IPTVBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render playlist management inputs', () => {
    renderComponent();
    expect(screen.getByPlaceholderText('M3U playlist URL...')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Playlist name...')).toBeInTheDocument();
    expect(screen.getByText('Add')).toBeInTheDocument();
  });

  it('should have disabled Add button when inputs are empty', () => {
    renderComponent();
    const addBtn = screen.getByText('Add');
    expect(addBtn).toBeDisabled();
  });

  it('should enable Add button when both inputs have values', () => {
    renderComponent();
    fireEvent.change(screen.getByPlaceholderText('M3U playlist URL...'), {
      target: { value: 'http://example.com/playlist.m3u' },
    });
    fireEvent.change(screen.getByPlaceholderText('Playlist name...'), {
      target: { value: 'Test Playlist' },
    });
    const addBtn = screen.getByText('Add');
    expect(addBtn).not.toBeDisabled();
  });

  it('should render playlist list when playlists exist', () => {
    mockUseIPTV.mockReturnValue({
      playlists: [
        { id: 'p1', name: 'My IPTV', channel_count: 100, group_count: 10, url: 'http://example.com/list.m3u', last_updated: '2024-01-01' },
      ],
      channels: [],
      selectedPlaylist: null,
      selectedGroup: null,
      loading: false,
      error: null,
      addPlaylist: mockAddPlaylist,
      addPlaylistContent: vi.fn(),
      removePlaylist: mockRemovePlaylist,
      refreshPlaylist: mockRefreshPlaylist,
      getChannels: mockGetChannels,
      selectGroup: mockSelectGroup,
      searchChannels: mockSearchChannels,
      refreshPlaylists: vi.fn(),
    });

    renderComponent();
    expect(screen.getByText('My IPTV')).toBeInTheDocument();
    expect(screen.getByText('100 channels')).toBeInTheDocument();
  });

  it('should render channel grid when channels exist', () => {
    mockUseIPTV.mockReturnValue({
      playlists: [
        { id: 'p1', name: 'My IPTV', channel_count: 2, group_count: 2, url: 'http://example.com/list.m3u', last_updated: '2024-01-01' },
      ],
      channels: [
        { id: 'ch1', name: 'CNN', url: 'http://cnn.m3u8', group: 'News', logo: undefined },
        { id: 'ch2', name: 'ESPN', url: 'http://espn.m3u8', group: 'Sports', logo: undefined },
      ],
      selectedPlaylist: 'p1',
      selectedGroup: null,
      loading: false,
      error: null,
      addPlaylist: mockAddPlaylist,
      addPlaylistContent: vi.fn(),
      removePlaylist: mockRemovePlaylist,
      refreshPlaylist: mockRefreshPlaylist,
      getChannels: mockGetChannels,
      selectGroup: mockSelectGroup,
      searchChannels: mockSearchChannels,
      refreshPlaylists: vi.fn(),
    });

    renderComponent();
    expect(screen.getByText('CNN')).toBeInTheDocument();
    expect(screen.getByText('ESPN')).toBeInTheDocument();
    // Channel cards exist (group text appears in both sidebar and cards)
    const channelCards = document.querySelectorAll('.iptv-channel-card');
    expect(channelCards).toHaveLength(2);
  });

  it('should show search input when playlist is selected', () => {
    mockUseIPTV.mockReturnValue({
      playlists: [
        { id: 'p1', name: 'My IPTV', channel_count: 2, group_count: 1, url: undefined, last_updated: '2024-01-01' },
      ],
      channels: [],
      selectedPlaylist: 'p1',
      selectedGroup: null,
      loading: false,
      error: null,
      addPlaylist: mockAddPlaylist,
      addPlaylistContent: vi.fn(),
      removePlaylist: mockRemovePlaylist,
      refreshPlaylist: mockRefreshPlaylist,
      getChannels: mockGetChannels,
      selectGroup: mockSelectGroup,
      searchChannels: mockSearchChannels,
      refreshPlaylists: vi.fn(),
    });

    renderComponent();
    expect(screen.getByPlaceholderText('Search channels...')).toBeInTheDocument();
  });

  it('should show group sidebar with categories', () => {
    mockUseIPTV.mockReturnValue({
      playlists: [
        { id: 'p1', name: 'My IPTV', channel_count: 3, group_count: 2, url: undefined, last_updated: '2024-01-01' },
      ],
      channels: [
        { id: 'ch1', name: 'CNN', url: 'http://cnn.m3u8', group: 'News', logo: undefined },
        { id: 'ch2', name: 'ESPN', url: 'http://espn.m3u8', group: 'Sports', logo: undefined },
        { id: 'ch3', name: 'FOX News', url: 'http://fox.m3u8', group: 'News', logo: undefined },
      ],
      selectedPlaylist: 'p1',
      selectedGroup: null,
      loading: false,
      error: null,
      addPlaylist: mockAddPlaylist,
      addPlaylistContent: vi.fn(),
      removePlaylist: mockRemovePlaylist,
      refreshPlaylist: mockRefreshPlaylist,
      getChannels: mockGetChannels,
      selectGroup: mockSelectGroup,
      searchChannels: mockSearchChannels,
      refreshPlaylists: vi.fn(),
    });

    renderComponent();
    // "All" group button with count
    expect(screen.getByText('All (3)')).toBeInTheDocument();
    // Group sidebar items exist
    const groupItems = document.querySelectorAll('.iptv-group-item');
    // "All" + "News" + "Sports" = 3 group items
    expect(groupItems.length).toBeGreaterThanOrEqual(3);
  });
});
