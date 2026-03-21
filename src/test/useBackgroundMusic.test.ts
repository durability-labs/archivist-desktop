import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---- Mock Audio ----

const mockPlay = vi.fn().mockResolvedValue(undefined);
const mockPause = vi.fn();

class MockAudio {
  src = '';
  loop = false;
  volume = 1;
  currentTime = 0;
  play = mockPlay;
  pause = mockPause;
}

vi.stubGlobal('Audio', MockAudio);

// ---- Mock Tauri APIs ----

// Control when resolveResource/readFile resolve
let resolveResourceFn: ((v: string) => void) | null = null;
let readFileFn: ((v: Uint8Array) => void) | null = null;

vi.mock('@tauri-apps/api/path', () => ({
  resolveResource: vi.fn(() => new Promise<string>((resolve) => {
    resolveResourceFn = resolve;
  })),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(() => new Promise<Uint8Array>((resolve) => {
    readFileFn = resolve;
  })),
}));

// Mock URL.createObjectURL
const mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url');
const mockRevokeObjectURL = vi.fn();
vi.stubGlobal('URL', { ...URL, createObjectURL: mockCreateObjectURL, revokeObjectURL: mockRevokeObjectURL });

// ---- Import after mocks ----
import { useBackgroundMusic } from '../hooks/useBackgroundMusic';

// ---- Helpers ----

/** Simulate the async audio loading completing */
async function completeAudioLoad() {
  // resolveResource
  await act(async () => {
    resolveResourceFn?.('/path/to/ripe-fruit.mp3');
    // Let microtasks flush
    await Promise.resolve();
  });
  // readFile
  await act(async () => {
    readFileFn?.(new Uint8Array([1, 2, 3]));
    await Promise.resolve();
  });
  // Let remaining microtasks (blob creation, Audio constructor) flush
  await act(async () => {
    await Promise.resolve();
  });
}

// ---- Tests ----

describe('useBackgroundMusic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveResourceFn = null;
    readFileFn = null;
    localStorage.clear();
    // Simulate Tauri environment
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it('plays immediately when startMusic called after audio loads', async () => {
    const { result } = renderHook(() => useBackgroundMusic());

    // Complete audio loading first
    await completeAudioLoad();

    // Now call startMusic — audio should be available
    act(() => {
      result.current.startMusic();
    });

    expect(mockPlay).toHaveBeenCalled();
    expect(result.current.isPlaying).toBe(true);
  });

  it('defers playback when startMusic called before audio loads', async () => {
    const { result } = renderHook(() => useBackgroundMusic());

    // Call startMusic before audio is loaded
    act(() => {
      result.current.startMusic();
    });

    // play should NOT have been called yet (audio not loaded)
    expect(mockPlay).not.toHaveBeenCalled();
    expect(result.current.isPlaying).toBe(false);

    // Now complete the audio load — should auto-play via pending flag
    await completeAudioLoad();

    expect(mockPlay).toHaveBeenCalled();
    expect(result.current.isPlaying).toBe(true);
  });

  it('does not play when disabled', async () => {
    localStorage.setItem('archivist_background_music_enabled', 'false');
    const { result } = renderHook(() => useBackgroundMusic());

    await completeAudioLoad();

    act(() => {
      result.current.startMusic();
    });

    expect(mockPlay).not.toHaveBeenCalled();
    expect(result.current.isPlaying).toBe(false);
  });

  it('toggle-on starts music even when currentTime is 0 (never played)', async () => {
    const { result } = renderHook(() => useBackgroundMusic());

    await completeAudioLoad();

    // Music was never started, so currentTime is 0
    // Simulate toggling ON via the custom event
    act(() => {
      window.dispatchEvent(new CustomEvent('background-music-toggle', { detail: true }));
    });

    expect(mockPlay).toHaveBeenCalled();
    expect(result.current.isPlaying).toBe(true);
  });

  it('exposes audioLoaded and loadError state', async () => {
    const { result } = renderHook(() => useBackgroundMusic());

    // Before loading completes
    expect(result.current.audioLoaded).toBe(false);
    expect(result.current.loadError).toBe(null);

    await completeAudioLoad();

    expect(result.current.audioLoaded).toBe(true);
    expect(result.current.loadError).toBe(null);
  });

  it('stopMusic pauses and resets', async () => {
    const { result } = renderHook(() => useBackgroundMusic());
    await completeAudioLoad();

    act(() => {
      result.current.startMusic();
    });
    expect(result.current.isPlaying).toBe(true);

    act(() => {
      result.current.stopMusic();
    });
    expect(mockPause).toHaveBeenCalled();
    expect(result.current.isPlaying).toBe(false);
  });
});
