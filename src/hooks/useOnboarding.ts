import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

const ONBOARDING_COMPLETE_KEY = 'archivist_onboarding_complete';
const ONBOARDING_STEP_KEY = 'archivist_onboarding_step';

export type OnboardingStep =
  | 'splash'
  | 'welcome'
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
  const [state, setState] = useState<OnboardingState>(defaultState);
  const [loading, setLoading] = useState(true);

  // Check if onboarding was already completed
  useEffect(() => {
    const hasCompleted = localStorage.getItem(ONBOARDING_COMPLETE_KEY);
    const savedStep = localStorage.getItem(ONBOARDING_STEP_KEY) as OnboardingStep | null;

    if (hasCompleted === 'true') {
      setState(prev => ({
        ...prev,
        isFirstRun: false,
        currentStep: 'complete',
      }));
    } else if (savedStep) {
      setState(prev => ({
        ...prev,
        currentStep: savedStep,
      }));
    }
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

  // Reset onboarding (for testing)
  const resetOnboarding = useCallback(() => {
    localStorage.removeItem(ONBOARDING_COMPLETE_KEY);
    localStorage.removeItem(ONBOARDING_STEP_KEY);
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
    // Convenience getters
    showOnboarding: state.isFirstRun && state.currentStep !== 'complete',
  };
}
