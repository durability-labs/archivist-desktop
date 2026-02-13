import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useIPTV } from '../hooks/useIPTV';
import '../styles/IPTVBrowser.css';

export default function IPTVBrowser() {
  const navigate = useNavigate();
  const {
    playlists,
    channels,
    selectedPlaylist,
    selectedGroup,
    loading,
    error,
    addPlaylist,
    removePlaylist,
    refreshPlaylist,
    getChannels,
    selectGroup,
    searchChannels,
  } = useIPTV();

  const [playlistUrl, setPlaylistUrl] = useState('');
  const [playlistName, setPlaylistName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const handleAddPlaylist = async () => {
    if (!playlistUrl.trim() || !playlistName.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const summary = await addPlaylist(playlistUrl.trim(), playlistName.trim());
      setPlaylistUrl('');
      setPlaylistName('');
      // Auto-select the new playlist
      await getChannels(summary.id);
    } catch (e) {
      setAddError(String(e));
    } finally {
      setAdding(false);
    }
  };

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (query.trim()) {
      searchChannels(query);
    } else if (selectedPlaylist) {
      getChannels(selectedPlaylist, selectedGroup);
    }
  }, [searchChannels, getChannels, selectedPlaylist, selectedGroup]);

  const handlePlayChannel = useCallback(async (channelUrl: string, channelName: string) => {
    try {
      const proxyUrl = await invoke<string | null>('get_proxy_url', {
        url: channelUrl,
        headers: null,
      });
      if (proxyUrl) {
        navigate(`/streaming/play?url=${encodeURIComponent(proxyUrl)}&title=${encodeURIComponent(channelName)}&live=true`);
      }
    } catch (e) {
      console.error('Failed to proxy channel:', e);
    }
  }, [navigate]);

  // Get groups for selected playlist
  const selectedPlaylistData = playlists.find(p => p.id === selectedPlaylist);

  return (
    <div className="iptv-browser">
      {/* Playlist management */}
      <div className="iptv-playlist-management">
        <div className="iptv-playlist-add">
          <div className="iptv-playlist-url">
            <input
              type="text"
              placeholder="M3U playlist URL..."
              value={playlistUrl}
              onChange={e => setPlaylistUrl(e.target.value)}
              disabled={adding}
            />
          </div>
          <div className="iptv-playlist-name">
            <input
              type="text"
              placeholder="Playlist name..."
              value={playlistName}
              onChange={e => setPlaylistName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddPlaylist()}
              disabled={adding}
            />
          </div>
          <button
            className="iptv-add-playlist-btn"
            onClick={handleAddPlaylist}
            disabled={adding || !playlistUrl.trim() || !playlistName.trim()}
          >
            {adding ? 'Adding...' : 'Add'}
          </button>
        </div>
        {addError && <div className="iptv-add-error">{addError}</div>}
        {error && <div className="iptv-add-error">{error}</div>}

        {/* Playlist list */}
        {playlists.length > 0 && (
          <div className="iptv-playlist-list">
            {playlists.map(p => (
              <div
                key={p.id}
                className={`iptv-playlist-item ${selectedPlaylist === p.id ? 'active' : ''}`}
                onClick={() => getChannels(p.id)}
              >
                <div className="iptv-playlist-info">
                  <span className="iptv-playlist-item-name">{p.name}</span>
                  <span className="iptv-playlist-item-count">{p.channel_count} channels</span>
                </div>
                <div className="iptv-playlist-actions">
                  {p.url && (
                    <button
                      className="iptv-refresh-btn"
                      onClick={e => { e.stopPropagation(); refreshPlaylist(p.id); }}
                      title="Refresh"
                    >
                      R
                    </button>
                  )}
                  <button
                    className="iptv-remove-btn"
                    onClick={e => { e.stopPropagation(); removePlaylist(p.id); }}
                    title="Remove"
                  >
                    X
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Channel browser */}
      {selectedPlaylist ? (
        <div className="iptv-channel-browser">
          {/* Search */}
          <div className="iptv-channel-search">
            <input
              type="text"
              placeholder="Search channels..."
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
            />
          </div>

          <div className="iptv-browser-layout">
            {/* Group sidebar */}
            {selectedPlaylistData && (
              <div className="iptv-group-sidebar">
                <button
                  className={`iptv-group-item ${!selectedGroup ? 'active' : ''}`}
                  onClick={() => selectGroup(null)}
                >
                  All ({selectedPlaylistData.channel_count})
                </button>
                {/* Groups are fetched from channels - we use the unique groups */}
                {[...new Set(channels.map(c => c.group).filter(Boolean))].sort().map(group => (
                  <button
                    key={group}
                    className={`iptv-group-item ${selectedGroup === group ? 'active' : ''}`}
                    onClick={() => selectGroup(group!)}
                  >
                    {group}
                  </button>
                ))}
              </div>
            )}

            {/* Channel grid */}
            <div className="iptv-channel-grid">
              {loading ? (
                <div className="iptv-loading">Loading channels...</div>
              ) : channels.length === 0 ? (
                <div className="iptv-no-channels">No channels found.</div>
              ) : (
                channels.map(channel => (
                  <button
                    key={channel.id}
                    className="iptv-channel-card"
                    onClick={() => handlePlayChannel(channel.url, channel.name)}
                  >
                    {channel.logo ? (
                      <img src={channel.logo} alt="" className="iptv-channel-logo" />
                    ) : (
                      <div className="iptv-channel-logo placeholder">TV</div>
                    )}
                    <div className="iptv-channel-name">{channel.name}</div>
                    {channel.group && (
                      <div className="iptv-channel-group">{channel.group}</div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : playlists.length > 0 ? (
        <div className="iptv-select-prompt">
          Select a playlist to browse channels.
        </div>
      ) : null}
    </div>
  );
}
