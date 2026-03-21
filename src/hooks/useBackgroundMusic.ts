import { useState, useEffect, useCallback, useRef } from 'react';
import { resolveResource } from '@tauri-apps/api/path';
import { readFile } from '@tauri-apps/plugin-fs';

const MUSIC_ENABLED_KEY = 'archivist_background_music_enabled';
const MUSIC_TOGGLE_EVENT = 'background-music-toggle';

export function useBackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioBlobUrlRef = useRef<string | null>(null);
  const pendingPlayRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioLoaded, setAudioLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabledState] = useState(() => {
    const stored = localStorage.getItem(MUSIC_ENABLED_KEY);
    return stored === null ? true : stored === 'true';
  });

  // Load audio on mount
  useEffect(() => {
    let cancelled = false;

    const loadAudio = async () => {
      const isTauri = !!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

      try {
        let audioUrl: string;
        if (isTauri) {
          const audioPath = await resolveResource('ripe-fruit.mp3');
          const fileData = await readFile(audioPath);
          const blob = new Blob([fileData], { type: 'audio/mpeg' });
          audioUrl = URL.createObjectURL(blob);
          if (!cancelled) {
            audioBlobUrlRef.current = audioUrl;
          } else {
            URL.revokeObjectURL(audioUrl);
            return;
          }
        } else {
          audioUrl = '/ripe-fruit.mp3';
        }

        if (!cancelled) {
          const audio = new Audio(audioUrl);
          audio.loop = true;
          audio.volume = 0.4;
          audioRef.current = audio;

          setAudioLoaded(true);

          // If startMusic() was called before audio finished loading, play now
          if (pendingPlayRef.current) {
            pendingPlayRef.current = false;
            audio.play().catch((err) => {
              console.warn('BackgroundMusic: Could not autoplay (deferred):', err);
            });
            setIsPlaying(true);
          }
        }
      } catch (err) {
        console.error('BackgroundMusic: Failed to load audio:', err);
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    };

    loadAudio();

    return () => {
      cancelled = true;
      pendingPlayRef.current = false;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (audioBlobUrlRef.current) {
        URL.revokeObjectURL(audioBlobUrlRef.current);
        audioBlobUrlRef.current = null;
      }
    };
  }, []);

  // Listen for toggle events from Settings page
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setEnabledState(detail);
      localStorage.setItem(MUSIC_ENABLED_KEY, String(detail));
      if (!detail && audioRef.current) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else if (detail && audioRef.current) {
        audioRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
    };

    window.addEventListener(MUSIC_TOGGLE_EVENT, handler);
    return () => window.removeEventListener(MUSIC_TOGGLE_EVENT, handler);
  }, []);

  const startMusic = useCallback(() => {
    if (!enabled) return;
    if (audioRef.current) {
      audioRef.current.play().catch((err) => {
        console.warn('BackgroundMusic: Could not autoplay:', err);
      });
      setIsPlaying(true);
    } else {
      // Audio not loaded yet — defer playback until load completes
      pendingPlayRef.current = true;
    }
  }, [enabled]);

  const stopMusic = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  }, []);

  const setEnabled = useCallback((value: boolean) => {
    localStorage.setItem(MUSIC_ENABLED_KEY, String(value));
    window.dispatchEvent(new CustomEvent(MUSIC_TOGGLE_EVENT, { detail: value }));
  }, []);

  return { startMusic, stopMusic, isPlaying, enabled, setEnabled, audioLoaded, loadError };
}
