import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';

interface NotificationSettings {
  sound_enabled: boolean;
  sound_on_startup: boolean;
  sound_on_peer_connect: boolean;
  sound_on_download: boolean;
  sound_on_chat_message: boolean;
  sound_volume: number;
  custom_startup_sound?: string | null;
  custom_peer_connect_sound?: string | null;
  custom_download_sound?: string | null;
}

// Extend Window interface for webkit prefix
interface WindowWithWebkit extends Window {
  webkitAudioContext?: typeof AudioContext;
}

// Reusable audio context (created once to avoid delay)
let audioContext: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as unknown as WindowWithWebkit).webkitAudioContext!)();
  }
  return audioContext;
}

// Cache for loaded audio buffers
const audioBufferCache: Map<string, AudioBuffer> = new Map();

// Load custom audio file and cache it
async function loadCustomSound(filePath: string): Promise<AudioBuffer | null> {
  try {
    // Check cache first
    if (audioBufferCache.has(filePath)) {
      return audioBufferCache.get(filePath)!;
    }

    // Convert file path to asset URL
    const assetUrl = convertFileSrc(filePath);

    // Fetch and decode audio
    const response = await fetch(assetUrl);
    const arrayBuffer = await response.arrayBuffer();
    const ctx = getAudioContext();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    // Cache it
    audioBufferCache.set(filePath, audioBuffer);
    return audioBuffer;
  } catch (error) {
    console.error('Failed to load custom sound:', error);
    return null;
  }
}

// Play custom audio file
function playCustomSound(audioBuffer: AudioBuffer, volume: number) {
  const ctx = getAudioContext();
  const source = ctx.createBufferSource();
  const gainNode = ctx.createGain();

  source.buffer = audioBuffer;
  source.connect(gainNode);
  gainNode.connect(ctx.destination);

  gainNode.gain.value = volume;
  source.start(0);
}

// Simple notification sounds using Web Audio API (fallback if no custom sound)
function playDefaultSound(type: 'startup' | 'peer-connect' | 'download' | 'chat-message', volume: number) {
  const ctx = getAudioContext();

  // Different frequencies for different notification types
  const frequencies: Record<typeof type, number[]> = {
    'startup': [523.25, 659.25, 783.99], // C5, E5, G5 (major chord)
    'peer-connect': [440, 554.37], // A4, C#5 (two notes)
    'download': [880, 987.77], // A5, B5 (high two notes)
    'chat-message': [587.33, 739.99], // D5, F#5 (notification)
  };

  const notes = frequencies[type];
  const noteDuration = 0.15;

  // Play each note in sequence
  notes.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.frequency.value = freq;
    osc.type = 'sine';

    const startTime = ctx.currentTime + (index * noteDuration);
    const endTime = startTime + noteDuration;

    // Set volume with envelope
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(volume * 0.3, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.01, endTime);

    osc.start(startTime);
    osc.stop(endTime);
  });
}

// Play notification sound (custom or default)
async function playNotificationSound(type: 'startup' | 'peer-connect' | 'download' | 'chat-message', volume: number, customSoundPath?: string | null) {
  // Try to play custom sound first
  if (customSoundPath) {
    const audioBuffer = await loadCustomSound(customSoundPath);
    if (audioBuffer) {
      playCustomSound(audioBuffer, volume);
      return;
    }
    // Fall through to default sound if custom sound failed to load
  }

  // Play default synthesized sound
  playDefaultSound(type, volume);
}

export function useSoundNotifications() {
  // Cache settings to avoid repeated fetches (causes delay)
  const settingsRef = useRef<NotificationSettings | null>(null);

  useEffect(() => {
    // Skip if not in Tauri environment (e.g., during tests)
    if (typeof window === 'undefined' || !(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
      return;
    }

    const setupListeners = async () => {
      // Fetch and cache notification settings
      const getSettings = async (): Promise<NotificationSettings> => {
        try {
          const config = await invoke<{ notifications: NotificationSettings }>('get_config');
          return config.notifications;
        } catch (error) {
          console.error('Failed to get notification settings:', error);
          return {
            sound_enabled: true,
            sound_on_startup: true,
            sound_on_peer_connect: true,
            sound_on_download: true,
            sound_on_chat_message: true,
            sound_volume: 0.5,
          };
        }
      };

      // Load settings once at startup
      settingsRef.current = await getSettings();

      // Refresh settings periodically (every 10 seconds) to pick up changes
      const settingsRefreshInterval = setInterval(async () => {
        settingsRef.current = await getSettings();
      }, 10000);

      // Node startup event
      const unlistenStartup = await listen('node-started', async () => {
        const settings = settingsRef.current || await getSettings();
        if (settings.sound_enabled && settings.sound_on_startup) {
          playNotificationSound('startup', settings.sound_volume, settings.custom_startup_sound);
        }
      });

      // Peer connection event
      const unlistenPeer = await listen<string>('peer-connected', async () => {
        const settings = settingsRef.current || await getSettings();
        if (settings.sound_enabled && settings.sound_on_peer_connect) {
          playNotificationSound('peer-connect', settings.sound_volume, settings.custom_peer_connect_sound);
        }
      });

      // File download event
      const unlistenDownload = await listen<string>('file-downloaded', async () => {
        const settings = settingsRef.current || await getSettings();
        if (settings.sound_enabled && settings.sound_on_download) {
          playNotificationSound('download', settings.sound_volume, settings.custom_download_sound);
        }
      });

      // Chat message received event
      const unlistenChat = await listen('chat-message-received', async () => {
        const settings = settingsRef.current || await getSettings();
        if (settings.sound_enabled && settings.sound_on_chat_message) {
          playNotificationSound('chat-message', settings.sound_volume);
        }
      });

      // Cleanup function
      return () => {
        clearInterval(settingsRefreshInterval);
        unlistenStartup();
        unlistenPeer();
        unlistenDownload();
        unlistenChat();
      };
    };

    const cleanup = setupListeners();

    return () => {
      cleanup.then((fn) => fn?.());
    };
  }, []);
}
