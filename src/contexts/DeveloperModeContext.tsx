/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';

const STORAGE_KEY = 'archivist_developer_mode';

interface DeveloperModeContextValue {
  developerMode: boolean;
  setDeveloperMode: (enabled: boolean) => void;
}

const DeveloperModeContext = createContext<DeveloperModeContextValue>({
  developerMode: false,
  setDeveloperMode: () => {},
});

interface AppConfig {
  [key: string]: unknown;
  developer_mode?: boolean;
}

export function DeveloperModeProvider({ children }: { children: ReactNode }) {
  // Initialize from localStorage cache for immediate reads
  const [developerMode, setDeveloperModeState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Sync from backend on mount
  useEffect(() => {
    let cancelled = false;

    invoke<AppConfig>('get_config')
      .then((config) => {
        if (!cancelled && typeof config.developer_mode === 'boolean') {
          setDeveloperModeState(config.developer_mode);
          try {
            localStorage.setItem(STORAGE_KEY, String(config.developer_mode));
          } catch {
            // localStorage unavailable
          }
        }
      })
      .catch(() => {
        // Backend unavailable, keep localStorage value
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setDeveloperMode = useCallback(async (enabled: boolean) => {
    // Update local state immediately for responsive UI
    setDeveloperModeState(enabled);

    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // localStorage unavailable
    }

    // Persist to backend
    try {
      const config = await invoke<AppConfig>('get_config');
      await invoke('save_config', {
        config: { ...config, developer_mode: enabled },
      });
    } catch {
      // Backend save failed — local state still reflects the user's intent.
      // Next mount will re-sync from backend if it comes back.
    }
  }, []);

  return (
    <DeveloperModeContext.Provider value={{ developerMode, setDeveloperMode }}>
      {children}
    </DeveloperModeContext.Provider>
  );
}

export function useDeveloperMode(): DeveloperModeContextValue {
  return useContext(DeveloperModeContext);
}
