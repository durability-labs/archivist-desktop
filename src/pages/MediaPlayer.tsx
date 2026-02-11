import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMediaStreaming, MediaLibraryItem } from '../hooks/useMediaStreaming';
import '../styles/MediaPlayer.css';

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function MediaPlayer() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const { serverUrl, library, loading, ensureServerRunning, refreshLibrary } = useMediaStreaming();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentItem, setCurrentItem] = useState<MediaLibraryItem | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(true);
  const [serverReady, setServerReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter to video items only for the playlist
  const videoItems = library.filter(item => !item.audioOnly);

  // Ensure streaming server is running on mount
  useEffect(() => {
    async function init() {
      const url = await ensureServerRunning();
      if (url) {
        setServerReady(true);
      } else {
        setError('Could not start streaming server. Enable it in Settings.');
      }
      await refreshLibrary();
    }
    init();
  }, [ensureServerRunning, refreshLibrary]);

  // Set current item and stream URL when taskId or library changes
  useEffect(() => {
    if (!serverUrl || !taskId || library.length === 0) return;
    const item = library.find(i => i.id === taskId);
    if (item) {
      setCurrentItem(item);
      setStreamUrl(`${serverUrl}/api/v1/media/${item.id}/stream`);
      setError(null);
    } else {
      setError('Media item not found in library.');
    }
  }, [taskId, library, serverUrl]);

  // Update time display
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  }, []);

  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);
  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    // Auto-play next in playlist
    if (currentItem && videoItems.length > 1) {
      const currentIndex = videoItems.findIndex(i => i.id === currentItem.id);
      if (currentIndex >= 0 && currentIndex < videoItems.length - 1) {
        const next = videoItems[currentIndex + 1];
        navigate(`/media/player/${next.id}`, { replace: true });
      }
    }
  }, [currentItem, videoItems, navigate]);

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
    } else {
      videoRef.current.pause();
    }
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const time = parseFloat(e.target.value);
    videoRef.current.currentTime = time;
    setCurrentTime(time);
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const vol = parseFloat(e.target.value);
    videoRef.current.volume = vol;
    setVolume(vol);
    setIsMuted(vol === 0);
  }, []);

  const toggleMute = useCallback(() => {
    if (!videoRef.current) return;
    if (isMuted) {
      videoRef.current.muted = false;
      setIsMuted(false);
    } else {
      videoRef.current.muted = true;
      setIsMuted(true);
    }
  }, [isMuted]);

  const handlePlaylistSelect = useCallback((item: MediaLibraryItem) => {
    navigate(`/media/player/${item.id}`, { replace: true });
  }, [navigate]);

  if (loading && !serverReady) {
    return (
      <div className="media-player-page">
        <div className="player-loading">
          <div className="spinner-small" />
          Loading media player...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="media-player-page">
        <div className="player-header">
          <button className="player-back-btn" onClick={() => navigate('/media')}>
            Back
          </button>
          <h1>Media Player</h1>
        </div>
        <div className="player-error">{error}</div>
      </div>
    );
  }

  return (
    <div className={`media-player-page ${showPlaylist ? 'with-playlist' : ''}`}>
      {/* Header */}
      <div className="player-header">
        <button className="player-back-btn" onClick={() => navigate('/media')}>
          Back
        </button>
        <h1 className="player-title">{currentItem?.title ?? 'Media Player'}</h1>
        <button
          className={`playlist-toggle-btn ${showPlaylist ? 'active' : ''}`}
          onClick={() => setShowPlaylist(!showPlaylist)}
          title="Toggle playlist"
        >
          Playlist ({videoItems.length})
        </button>
      </div>

      <div className="player-body">
        {/* Video area */}
        <div className="player-main">
          {streamUrl ? (
            <>
              <div className="video-container" onClick={togglePlay}>
                <video
                  ref={videoRef}
                  src={streamUrl}
                  autoPlay
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  onPlay={handlePlay}
                  onPause={handlePause}
                  onEnded={handleEnded}
                  onError={() => setError('Failed to load video. The file may have been moved or deleted.')}
                />
              </div>

              {/* Controls */}
              <div className="player-controls">
                <button className="control-btn play-btn" onClick={togglePlay}>
                  {isPlaying ? 'II' : '>>'}
                </button>

                <span className="time-display">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>

                <input
                  type="range"
                  className="seek-bar"
                  min={0}
                  max={duration || 0}
                  step={0.1}
                  value={currentTime}
                  onChange={handleSeek}
                />

                <button className="control-btn mute-btn" onClick={toggleMute}>
                  {isMuted ? 'Mx' : 'V'}
                </button>

                <input
                  type="range"
                  className="volume-bar"
                  min={0}
                  max={1}
                  step={0.01}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                />
              </div>
            </>
          ) : (
            <div className="player-empty">
              <p>Select a video from the playlist to start playing.</p>
            </div>
          )}
        </div>

        {/* Playlist sidebar */}
        {showPlaylist && (
          <aside className="playlist-sidebar">
            <div className="playlist-header">
              <h3>Library</h3>
            </div>
            <div className="playlist-items">
              {videoItems.length === 0 ? (
                <div className="playlist-empty">
                  No videos available. Download some media first.
                </div>
              ) : (
                videoItems.map((item) => (
                  <button
                    key={item.id}
                    className={`playlist-item ${item.id === taskId ? 'active' : ''}`}
                    onClick={() => handlePlaylistSelect(item)}
                  >
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt="" className="playlist-thumb" />
                    ) : (
                      <div className="playlist-thumb placeholder" />
                    )}
                    <div className="playlist-item-info">
                      <div className="playlist-item-title">{item.title}</div>
                      <div className="playlist-item-meta">
                        {formatBytes(item.fileSize)}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
