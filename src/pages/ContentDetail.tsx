import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import type { MetaItem, StreamWithAddon } from '../lib/stremioTypes';
import { useDebrid } from '../hooks/useDebrid';
import '../styles/ContentDetail.css';

export default function ContentDetail() {
  const { type: contentType, id } = useParams<{ type: string; id: string }>();
  const navigate = useNavigate();
  const { configured: debridConfigured, resolveStream, checkCache } = useDebrid();

  const [meta, setMeta] = useState<MetaItem | null>(null);
  const [streams, setStreams] = useState<StreamWithAddon[]>([]);
  const [cacheResults, setCacheResults] = useState<Map<string, boolean>>(new Map());
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);

  // Load metadata
  useEffect(() => {
    if (!contentType || !id) return;
    (async () => {
      try {
        setLoading(true);
        const metaResult = await invoke<MetaItem>('get_stremio_meta', {
          contentType,
          id,
        });
        setMeta(metaResult);

        // For movies, load streams immediately
        if (contentType === 'movie') {
          setSelectedVideoId(id);
        }
        // For series, set first season
        if (metaResult.videos && metaResult.videos.length > 0) {
          const seasons = [...new Set(metaResult.videos.map(v => v.season).filter(Boolean))];
          if (seasons.length > 0) {
            setSelectedSeason(seasons[0] ?? null);
          }
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [contentType, id]);

  // Load streams when video ID is selected
  useEffect(() => {
    if (!contentType || !selectedVideoId) return;
    (async () => {
      try {
        const streamsResult = await invoke<StreamWithAddon[]>('get_stremio_streams', {
          contentType,
          videoId: selectedVideoId,
        });
        setStreams(streamsResult);

        // Check debrid cache for infoHash streams
        if (debridConfigured) {
          const hashes = streamsResult
            .filter(s => s.stream.infoHash)
            .map(s => s.stream.infoHash as string);
          if (hashes.length > 0) {
            try {
              const results = await checkCache(hashes);
              const map = new Map<string, boolean>();
              results.forEach(r => map.set(r.info_hash, r.is_cached));
              setCacheResults(map);
            } catch {
              // Cache check is optional
            }
          }
        }
      } catch {
        // Streams may not be available for meta-only addons
        setStreams([]);
      }
    })();
  }, [contentType, selectedVideoId, debridConfigured, checkCache]);

  const handlePlayStream = useCallback(async (streamWithAddon: StreamWithAddon) => {
    const stream = streamWithAddon.stream;

    try {
      setResolving(JSON.stringify(stream));

      let playUrl: string | null = null;
      let title = meta?.name || 'Stream';

      if (stream.url) {
        // Direct URL - proxy it
        const proxyUrl = await invoke<string | null>('get_proxy_url', {
          url: stream.url,
          headers: stream.behaviorHints?.proxyHeaders?.request || null,
        });
        playUrl = proxyUrl;
      } else if (stream.infoHash && debridConfigured) {
        // Resolve through debrid
        const resolved = await resolveStream(stream);
        const proxyUrl = await invoke<string | null>('get_proxy_url', {
          url: resolved.url,
          headers: null,
        });
        playUrl = proxyUrl;
        if (resolved.filename) {
          title = resolved.filename;
        }
      } else if (stream.externalUrl) {
        // Open external URL in browser
        window.open(stream.externalUrl, '_blank');
        setResolving(null);
        return;
      } else {
        setError('Cannot play this stream. No direct URL or debrid provider configured.');
        setResolving(null);
        return;
      }

      if (playUrl) {
        const isLive = false;
        navigate(`/streaming/play?url=${encodeURIComponent(playUrl)}&title=${encodeURIComponent(title)}&live=${isLive}`);
      }
    } catch (e) {
      setError(`Failed to resolve stream: ${e}`);
    } finally {
      setResolving(null);
    }
  }, [meta, debridConfigured, resolveStream, navigate]);

  if (loading) {
    return (
      <div className="content-detail">
        <div className="content-loading">Loading content details...</div>
      </div>
    );
  }

  if (error && !meta) {
    return (
      <div className="content-detail">
        <button className="content-back-btn" onClick={() => navigate('/streaming')}>
          Back
        </button>
        <div className="content-error">{error}</div>
      </div>
    );
  }

  if (!meta) return null;

  const seasons = meta.videos
    ? [...new Set(meta.videos.map(v => v.season).filter((s): s is number => s != null))].sort()
    : [];

  const episodes = meta.videos?.filter(v => v.season === selectedSeason) || [];

  return (
    <div className="content-detail">
      {/* Background */}
      {meta.background && (
        <div
          className="content-background"
          style={{ backgroundImage: `url(${meta.background})` }}
        />
      )}

      {/* Header */}
      <div className="content-header">
        <button className="content-back-btn" onClick={() => navigate('/streaming')}>
          Back
        </button>
      </div>

      <div className="content-body">
        {/* Poster + Info */}
        <div className="content-meta">
          {meta.poster && (
            <img src={meta.poster} alt={meta.name} className="content-poster" />
          )}
          <div className="content-info">
            <h1 className="content-title">{meta.name}</h1>
            <div className="content-meta-row">
              {meta.year && <span>{meta.year}</span>}
              {meta.runtime && <span>{meta.runtime}</span>}
              {meta.imdbRating && <span>IMDb {meta.imdbRating}</span>}
              {meta.releaseInfo && <span>{meta.releaseInfo}</span>}
            </div>
            {meta.genres && meta.genres.length > 0 && (
              <div className="content-genres">
                {meta.genres.map(g => (
                  <span key={g} className="genre-tag">{g}</span>
                ))}
              </div>
            )}
            {meta.description && (
              <p className="content-description">{meta.description}</p>
            )}
            {meta.cast && meta.cast.length > 0 && (
              <div className="content-cast">
                Cast: {meta.cast.slice(0, 5).join(', ')}
              </div>
            )}
          </div>
        </div>

        {/* Series: Season/Episode selector */}
        {contentType === 'series' && seasons.length > 0 && (
          <div className="season-selector">
            <div className="season-tabs">
              {seasons.map(s => (
                <button
                  key={s}
                  className={`season-tab ${selectedSeason === s ? 'active' : ''}`}
                  onClick={() => setSelectedSeason(s)}
                >
                  Season {s}
                </button>
              ))}
            </div>
            <div className="episode-list">
              {episodes.map(ep => (
                <button
                  key={ep.id}
                  className={`episode-item ${selectedVideoId === ep.id ? 'active' : ''}`}
                  onClick={() => setSelectedVideoId(ep.id)}
                >
                  <span className="episode-number">E{ep.episode}</span>
                  <span className="episode-title">{ep.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Streams */}
        {selectedVideoId && (
          <div className="stream-section">
            <h3>Streams</h3>
            {error && <div className="stream-error">{error}</div>}
            {streams.length === 0 ? (
              <div className="stream-empty">No streams available for this content.</div>
            ) : (
              <div className="stream-list">
                {streams.map((sw, i) => {
                  const s = sw.stream;
                  const isCached = s.infoHash ? cacheResults.get(s.infoHash) : undefined;
                  const isResolving = resolving === JSON.stringify(s);

                  return (
                    <button
                      key={i}
                      className="stream-item"
                      onClick={() => handlePlayStream(sw)}
                      disabled={isResolving}
                    >
                      <div className="stream-info">
                        <span className="stream-addon">{sw.addon_name}</span>
                        {s.name && <span className="stream-name">{s.name}</span>}
                        {s.title && <span className="stream-title">{s.title}</span>}
                      </div>
                      <div className="stream-badges">
                        {s.infoHash && isCached === true && (
                          <span className="cached-badge">Cached</span>
                        )}
                        {s.infoHash && isCached === false && (
                          <span className="not-cached-badge">Not cached</span>
                        )}
                        {s.url && <span className="direct-badge">Direct</span>}
                        {isResolving && <span className="resolving-badge">Resolving...</span>}
                      </div>
                      <span className="stream-play-btn">{isResolving ? '...' : '>>'}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
