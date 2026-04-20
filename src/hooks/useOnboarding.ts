/* eslint-disable react-hooks/exhaustive-deps */
// setState is a module-level function (setSharedState) that never changes —
// safe to omit from dependency arrays throughout this file.
import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';

const ONBOARDING_COMPLETE_KEY = 'archivist_onboarding_complete';
const ONBOARDING_STEP_KEY = 'archivist_onboarding_step';

// ── Shared singleton store ──────────────────────────────────────────────────
// Multiple components call useOnboarding() (App and Onboarding). Using plain
// useState in each creates independent copies that drift — clicking "I
// Understand" in Onboarding's copy doesn't update App's copy. This singleton
// ensures every caller sees the same onboarding state.
let sharedState: OnboardingState | null = null;
const listeners = new Set<() => void>();
function getSharedState() {
  return sharedState;
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function setSharedState(next: OnboardingState | ((prev: OnboardingState) => OnboardingState)) {
  const prev = sharedState ?? defaultState;
  sharedState = typeof next === 'function' ? next(prev) : next;
  listeners.forEach((cb) => cb());
}

export type OnboardingStep =
  | 'splash'
  | 'disclaimer'
  | 'welcome'
  | 'wallet-setup'
  | 'node-starting'
  | 'folder-select'
  | 'syncing'
  | 'complete';

export interface OnboardingState {
  isFirstRun: boolean;
  currentStep: OnboardingStep;
  quickBackupPath: string | null;
  nodeReady: boolean;
  firstFileCid: string | null;
  error: string | null;
}

const defaultState: OnboardingState = {
  isFirstRun: true,
  currentStep: 'splash',
  quickBackupPath: null,
  nodeReady: false,
  firstFileCid: null,
  error: null,
};

export function useOnboarding() {
  // All callers share the same state via a module-level singleton.
  const state = useSyncExternalStore(subscribe, () => getSharedState() ?? defaultState);
  const setState = setSharedState;
  const [loading, setLoading] = useState(!sharedState);

  // Initialize: the splash + disclaimer + welcome intro cards play on EVERY
  // launch regardless of whether first-run setup was done before. Only the
  // setup steps (wallet/folder/syncing) are gated on ONBOARDING_COMPLETE_KEY.
  // `isFirstRun` controls whether the Welcome card's "Get Started" routes to
  // wallet-setup (first launch) or dismisses onboarding to the Dashboard
  // (return launch).
  useEffect(() => {
    // Only the first mount initializes shared state. Subsequent mounts (e.g.
    // Onboarding component mounting after App) reuse the existing state.
    if (sharedState) {
      setLoading(false);
      return;
    }

    const hasCompleted = localStorage.getItem(ONBOARDING_COMPLETE_KEY) === 'true';
    localStorage.removeItem(ONBOARDING_STEP_KEY);

    // Test-only: skip the splash VIDEO step for automated tests where the
    // <video> element is unreliable. Read from sessionStorage so the flag
    // CANNOT leak across app launches into a real user's session — it
    // auto-clears when the WebView2 window closes.
    //
    // Mop up any stale localStorage flag from older test runs (the previous
    // implementation used localStorage which persisted between launches and
    // caused the splash to be silently skipped after the e2e suite ran).
    const skipSplash =
      sessionStorage.getItem('__archivist_test_skip_splash') === 'true';
    localStorage.removeItem('__archivist_test_skip_splash');

    setState((prev) => ({
      ...prev,
      isFirstRun: !hasCompleted,
      currentStep: skipSplash ? 'disclaimer' : 'splash',
    }));
    setLoading(false);
  }, []);

  // Set current step and persist
  const setStep = useCallback((step: OnboardingStep) => {
    setState(prev => ({ ...prev, currentStep: step, error: null }));
    localStorage.setItem(ONBOARDING_STEP_KEY, step);
  }, []);

  // Mark node as ready
  const setNodeReady = useCallback((ready: boolean) => {
    setState(prev => ({ ...prev, nodeReady: ready }));
  }, []);

  // Set the quickstart folder path
  const setQuickBackupPath = useCallback((path: string) => {
    setState(prev => ({ ...prev, quickBackupPath: path }));
  }, []);

  // Set first synced file CID
  const setFirstFileCid = useCallback((cid: string) => {
    setState(prev => ({ ...prev, firstFileCid: cid }));
  }, []);

  // Set error message
  const setError = useCallback((error: string | null) => {
    setState(prev => ({ ...prev, error }));
  }, []);

  // Create quickstart folder with sample file
  const createQuickstartFolder = useCallback(async (): Promise<string> => {
    try {
      const path = await invoke<string>('create_quickstart_folder');
      setQuickBackupPath(path);
      return path;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      throw e;
    }
  }, [setQuickBackupPath, setError]);

  // Complete onboarding
  const completeOnboarding = useCallback(() => {
    localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
    localStorage.removeItem(ONBOARDING_STEP_KEY);
    setState(prev => ({
      ...prev,
      isFirstRun: false,
      currentStep: 'complete',
    }));
  }, []);

  // Skip onboarding (for power users)
  const skipOnboarding = useCallback(() => {
    completeOnboarding();
  }, [completeOnboarding]);

  // Reset onboarding (for testing). Clears persistent AND shared state.
  const resetOnboarding = useCallback(() => {
    localStorage.removeItem(ONBOARDING_COMPLETE_KEY);
    localStorage.removeItem(ONBOARDING_STEP_KEY);
    localStorage.removeItem('__archivist_test_skip_splash');
    sessionStorage.removeItem('__archivist_test_skip_splash');
    sharedState = null; // allow the next useEffect to reinitialize
    setState({
      ...defaultState,
      isFirstRun: true,
    });
  }, []);

  return {
    ...state,
    loading,
    setStep,
    setNodeReady,
    setQuickBackupPath,
    setFirstFileCid,
    setError,
    createQuickstartFolder,
    completeOnboarding,
    skipOnboarding,
    resetOnboarding,
    // Convenience getter — intro cards always play, so this is driven by the
    // step alone, not `isFirstRun`. `completeOnboarding` sets step to 'complete'.
    showOnboarding: state.currentStep !== 'complete',
  };
}
