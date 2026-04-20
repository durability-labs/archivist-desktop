/**
 * Regression tests for Settings auto-save behavior.
 *
 * We removed the "Save Settings" button because it was in an awkward place and
 * users didn't know to click it. Changes now persist automatically ~600ms after
 * the user stops editing. These tests pin that behavior so nobody reintroduces
 * a manual-save button.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { ToastProvider } from '../contexts/ToastContext';
import Settings from '../pages/Settings';

// Mock hooks that Settings pulls in
vi.mock('../hooks/useFeatures', () => ({
  useFeatures: () => ({ marketplaceEnabled: false, walletEnabled: false, zkProofsEnabled: false }),
}));
vi.mock('../hooks/useBackgroundMusic', () => ({
  useBackgroundMusic: () => ({
    audioLoaded: false,
    loadError: null,
    startMusic: vi.fn(),
  }),
}));
vi.mock('../contexts/DeveloperModeContext', () => ({
  useDeveloperMode: () => ({ developerMode: false, setDeveloperMode: vi.fn() }),
}));

const mockedInvoke = vi.mocked(invoke);

function baseConfig() {
  return {
    theme: 'system',
    language: 'en',
    start_minimized: false,
    start_on_boot: false,
    close_to_tray: true,
    developer_mode: false,
    node: {
      data_directory: 'C:\\users\\test\\archivist',
      api_port: 8080,
      discovery_port: 8090,
      listen_port: 8070,
      max_storage_gb: 10,
      auto_start: true,
      log_level: 'DEBUG',
      announce_ip: null,
    },
    sync: {
      auto_sync: true,
      sync_interval_seconds: 300,
      bandwidth_limit_mbps: null,
      exclude_patterns: [],
      backup_enabled: false,
      backup_peer_address: null,
      backup_peer_nickname: null,
      backup_manifest_enabled: true,
      backup_auto_notify: false,
      manifest_update_threshold: 1,
    },
    notifications: {
      sound_enabled: true,
      sound_on_startup: true,
      sound_on_peer_connect: true,
      sound_on_download: true,
      sound_volume: 0.5,
    },
    backup_server: { enabled: false, poll_interval_secs: 30, max_concurrent_downloads: 3, max_retries: 3, auto_delete_tombstones: true, source_peers: [] },
    manifest_server: { enabled: false, port: 8085, allowed_ips: [] },
    media_streaming: { enabled: false, port: 8087, allowed_ips: [] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockedInvoke.mockImplementation((cmd: string) => {
    switch (cmd) {
      case 'get_config':
        return Promise.resolve(baseConfig());
      case 'get_app_version':
        return Promise.resolve('0.2.5');
      case 'get_platform':
        return Promise.resolve('windows');
      case 'save_config':
        return Promise.resolve(undefined);
      default:
        return Promise.resolve(undefined);
    }
  });
});

function renderSettings() {
  return render(
    <ToastProvider>
      <Settings />
    </ToastProvider>,
  );
}

describe('Settings — auto-save', () => {
  it('does NOT render a "Save Settings" button', async () => {
    renderSettings();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.queryByRole('button', { name: /save settings/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
  });

  it('displays the "Changes save automatically" status hint', async () => {
    renderSettings();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByText(/changes save automatically/i)).toBeInTheDocument();
  });

  it('does not invoke save_config on initial load (baseline matches disk)', async () => {
    renderSettings();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    const saveCalls = mockedInvoke.mock.calls.filter(([cmd]) => cmd === 'save_config');
    expect(saveCalls.length).toBe(0);
  });

  it('invokes save_config after a user change, debounced to ~600ms', async () => {
    renderSettings();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // Find the Theme <select> (label isn't associated via for/id — look up by sibling).
    const themeLabel = screen.getByText('Theme');
    const themeSelect = themeLabel.parentElement!.querySelector('select') as HTMLSelectElement;

    // fireEvent is synchronous and plays nice with fake timers (unlike userEvent).
    await act(async () => {
      fireEvent.change(themeSelect, { target: { value: 'dark' } });
    });

    // Before debounce fires — no save yet
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(mockedInvoke.mock.calls.filter(([cmd]) => cmd === 'save_config').length).toBe(0);

    // Past the debounce window — save fires exactly once
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    const saveCalls = mockedInvoke.mock.calls.filter(([cmd]) => cmd === 'save_config');
    expect(saveCalls.length).toBe(1);
    const payload = saveCalls[0][1] as { config: { theme: string } };
    expect(payload.config.theme).toBe('dark');
  });

  it('debounces rapid consecutive edits into a single save', async () => {
    renderSettings();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    const themeLabel = screen.getByText('Theme');
    const themeSelect = themeLabel.parentElement!.querySelector('select') as HTMLSelectElement;

    // Rapid consecutive changes within the debounce window.
    await act(async () => {
      fireEvent.change(themeSelect, { target: { value: 'dark' } });
      fireEvent.change(themeSelect, { target: { value: 'light' } });
      fireEvent.change(themeSelect, { target: { value: 'system' } });
      fireEvent.change(themeSelect, { target: { value: 'dark' } });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    const saveCalls = mockedInvoke.mock.calls.filter(([cmd]) => cmd === 'save_config');
    expect(saveCalls.length).toBe(1);
    const payload = saveCalls[0][1] as { config: { theme: string } };
    expect(payload.config.theme).toBe('dark');
  });
});
