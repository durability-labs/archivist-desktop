import { useState, useEffect, useCallback, useRef } from 'react';
import { useNode } from '../hooks/useNode';
import { useSync } from '../hooks/useSync';
import { useOnboarding, OnboardingStep } from '../hooks/useOnboarding';
import { open } from '@tauri-apps/plugin-dialog';
import '../styles/Onboarding.css';

interface OnboardingProps {
  onComplete: () => void;
  onSkip: () => void;
}

function Onboarding({ onComplete, onSkip }: OnboardingProps) {
  const {
    currentStep,
    setStep,
    nodeReady,
    setNodeReady,
    quickBackupPath,
    setQuickBackupPath,
    firstFileCid,
    setFirstFileCid,
    error,
    setError,
    createQuickstartFolder,
  } = useOnboarding();

  const { status, startNode, isRunning } = useNode();
  const { addWatchFolder, syncState } = useSync();

  const [isStartingNode, setIsStartingNode] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [syncProgress, setSyncProgress] = useState<'connecting' | 'watching' | 'syncing' | 'complete'>('connecting');

  // Track if sync completion timer has been started to prevent cycling
  const syncCompletionStarted = useRef(false);

  // Auto-start node when entering 'node-starting' step
  useEffect(() => {
    if (currentStep === 'node-starting' && !isRunning && !isStartingNode) {
      setIsStartingNode(true);
      startNode()
        .then(() => {
          setIsStartingNode(false);
        })
        .catch((e) => {
          setIsStartingNode(false);
          setError(e instanceof Error ? e.message : String(e));
        });
    }
  }, [currentStep, isRunning, isStartingNode, startNode, setError]);

  // Auto-advance when node becomes ready
  useEffect(() => {
    if (currentStep === 'node-starting' && isRunning && status?.state === 'running') {
      setNodeReady(true);
      // Small delay for UX - let user see "Ready" before advancing
      const timer = setTimeout(() => {
        setStep('folder-select');
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [currentStep, isRunning, status?.state, setNodeReady, setStep]);

  // Single effect to handle sync progress with fixed timing
  // This runs once when entering 'syncing' step and uses absolute timers
  useEffect(() => {
    if (currentStep !== 'syncing') {
      return;
    }

    // Reset completion flag when entering syncing step
    syncCompletionStarted.current = false;

    // Fixed timing for progress states - these won't be reset
    const watchingTimer = setTimeout(() => {
      if (!syncCompletionStarted.current) {
        setSyncProgress('watching');
      }
    }, 1500);

    const syncingTimer = setTimeout(() => {
      if (!syncCompletionStarted.current) {
        setSyncProgress('syncing');
      }
    }, 3500);

    const completeTimer = setTimeout(() => {
      if (!syncCompletionStarted.current) {
        syncCompletionStarted.current = true;
        setSyncProgress('complete');
        setFirstFileCid('synced');
      }
    }, 6000);

    return () => {
      clearTimeout(watchingTimer);
      clearTimeout(syncingTimer);
      clearTimeout(completeTimer);
    };
  }, [currentStep, setFirstFileCid]);

  // Early completion: if actual sync finishes before timers, complete immediately
  useEffect(() => {
    if (currentStep !== 'syncing' || !quickBackupPath || syncCompletionStarted.current) {
      return;
    }

    // Find the folder we just added (normalize paths for comparison)
    const normalizedPath = quickBackupPath.replace(/\\/g, '/').replace(/\/+$/, '');
    const folder = syncState.folders.find(f => {
      const folderPath = f.path.replace(/\\/g, '/').replace(/\/+$/, '');
      return folderPath === normalizedPath;
    });

    // If folder has files synced, complete early
    if (folder && folder.fileCount > 0) {
      syncCompletionStarted.current = true;
      setSyncProgress('complete');
      setFirstFileCid('synced');
    }
  }, [currentStep, quickBackupPath, syncState.folders, setFirstFileCid]);

  // Handle "Get Started" click
  const handleGetStarted = useCallback(() => {
    setStep('node-starting');
  }, [setStep]);

  // Handle "Quick Backup" click
  const handleQuickBackup = useCallback(async () => {
    setIsCreatingFolder(true);
    setError(null);
    try {
      const path = await createQuickstartFolder();
      setQuickBackupPath(path);
      await addWatchFolder(path);
      setStep('syncing');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsCreatingFolder(false);
    }
  }, [createQuickstartFolder, setQuickBackupPath, addWatchFolder, setStep, setError]);

  // Handle "Choose Folder" click
  const handleChooseFolder = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        title: 'Select folder to backup',
      });

      if (selected && typeof selected === 'string') {
        setQuickBackupPath(selected);
        await addWatchFolder(selected);
        setStep('syncing');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [setQuickBackupPath, addWatchFolder, setStep, setError]);

  // Handle completion - use prop from App to ensure shared state
  const handleComplete = useCallback(() => {
    onComplete();
  }, [onComplete]);

  // Handle skip - use prop from App to ensure shared state
  const handleSkip = useCallback(() => {
    onSkip();
  }, [onSkip]);

  // Handle splash screen completion (video ended or skip)
  const handleSplashComplete = useCallback(() => {
    setStep('welcome');
  }, [setStep]);

  // Render current step
  const renderStep = () => {
    switch (currentStep) {
      case 'splash':
        return <SplashScreen onComplete={handleSplashComplete} onSkip={handleSplashComplete} />;
      case 'welcome':
        return <WelcomeScreen onGetStarted={handleGetStarted} onSkip={handleSkip} />;
      case 'node-starting':
        return <NodeStartingScreen isRunning={isRunning} nodeReady={nodeReady} error={error} />;
      case 'folder-select':
        return (
          <FolderSelectScreen
            onQuickBackup={handleQuickBackup}
            onChooseFolder={handleChooseFolder}
            isCreatingFolder={isCreatingFolder}
            error={error}
          />
        );
      case 'syncing':
        return (
          <SyncingScreen
            syncProgress={syncProgress}
            folderPath={quickBackupPath}
            firstFileCid={firstFileCid}
            onComplete={handleComplete}
          />
        );
      default:
        return null;
    }
  };

  // For splash screen, render without the container chrome
  if (currentStep === 'splash') {
    return <SplashScreen onComplete={handleSplashComplete} onSkip={handleSplashComplete} />;
  }

  return (
    <div className="onboarding-container">
      <div className="onboarding-content">
        {renderStep()}
      </div>
      <StepIndicator currentStep={currentStep} />
    </div>
  );
}

// Step indicator component
interface StepIndicatorProps {
  currentStep: OnboardingStep;
}

function StepIndicator({ currentStep }: StepIndicatorProps) {
  const steps: OnboardingStep[] = ['welcome', 'node-starting', 'folder-select', 'syncing'];
  const currentIndex = steps.indexOf(currentStep);

  return (
    <div className="step-indicator">
      {steps.map((step, index) => (
        <div
          key={step}
          className={`step-dot ${index <= currentIndex ? 'active' : ''} ${index < currentIndex ? 'completed' : ''}`}
        />
      ))}
    </div>
  );
}

// Splash screen component - plays branding video
interface SplashScreenProps {
  onComplete: () => void;
  onSkip: () => void;
}

function SplashScreen({ onComplete, onSkip }: SplashScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);

  // Helper to add debug messages
  const addDebug = useCallback((msg: string) => {
    setDebugInfo(prev => [...prev.slice(-4), msg]); // Keep last 5 messages
    console.log('SplashScreen:', msg);
  }, []);

  // Log environment info for debugging
  useEffect(() => {
    const env = {
      protocol: window.location.protocol,
      origin: window.location.origin,
      href: window.location.href,
      baseUrl: import.meta.env.BASE_URL,
    };
    addDebug(`Protocol: ${env.protocol}`);
    addDebug(`Origin: ${env.origin}`);
    console.log('SplashScreen environment:', env);
  }, [addDebug]);

  // Handle video load success
  const handleCanPlay = useCallback(() => {
    addDebug('Video ready to play!');
    setVideoLoaded(true);
  }, [addDebug]);

  // Handle video error - skip to welcome after brief delay
  const handleVideoError = useCallback((e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const video = e.currentTarget;
    const error = video.error;
    const errorMsg = error ? `Error ${error.code}: ${error.message}` : 'Unknown error';
    addDebug(`Video error: ${errorMsg}`);
    setErrorDetails(`${errorMsg}\nSrc: ${video.currentSrc}\nNetwork: ${video.networkState}, Ready: ${video.readyState}`);
    console.error('Video error:', {
      code: error?.code,
      message: error?.message,
      currentSrc: video.currentSrc,
      networkState: video.networkState,
      readyState: video.readyState,
    });
    setVideoFailed(true);
    // Skip to welcome after a delay so user can see the error
    setTimeout(onComplete, 2000);
  }, [onComplete, addDebug]);

  // If video hasn't loaded after 5 seconds, skip it
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!videoLoaded && !videoFailed) {
        addDebug('Video load timeout (5s), skipping...');
        setTimeout(onComplete, 1000);
      }
    }, 5000);
    return () => clearTimeout(timeout);
  }, [videoLoaded, videoFailed, onComplete, addDebug]);

  return (
    <div className="splash-screen">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="splash-video"
        onEnded={onComplete}
        onCanPlay={handleCanPlay}
        onError={handleVideoError}
      >
        {/* Try multiple source paths for different environments */}
        <source src={`${import.meta.env.BASE_URL}intro.mp4`} type="video/mp4" />
        <source src="/intro.mp4" type="video/mp4" />
        <source src="./intro.mp4" type="video/mp4" />
        <source src="intro.mp4" type="video/mp4" />
      </video>
      {/* On-screen debug info */}
      <div style={{
        position: 'absolute',
        bottom: '80px',
        left: '20px',
        right: '20px',
        color: 'rgba(255,255,255,0.8)',
        fontSize: '11px',
        fontFamily: 'monospace',
        textAlign: 'left',
        background: 'rgba(0,0,0,0.5)',
        padding: '8px 12px',
        borderRadius: '4px',
        maxHeight: '120px',
        overflow: 'auto',
      }}>
        {debugInfo.map((msg, i) => (
          <div key={i}>{msg}</div>
        ))}
        {errorDetails && (
          <div style={{ color: '#ff6b6b', marginTop: '4px', whiteSpace: 'pre-wrap' }}>
            {errorDetails}
          </div>
        )}
        {!videoLoaded && !videoFailed && !errorDetails && (
          <div style={{ color: '#ffd93d' }}>Loading video...</div>
        )}
      </div>
      <button className="splash-skip" onClick={onSkip}>
        Skip
      </button>
    </div>
  );
}

// Welcome screen component
interface WelcomeScreenProps {
  onGetStarted: () => void;
  onSkip: () => void;
}

function WelcomeScreen({ onGetStarted, onSkip }: WelcomeScreenProps) {
  return (
    <div className="onboarding-screen welcome-screen">
      <div className="welcome-icon">
        <svg viewBox="0 0 24 24" width="64" height="64">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h1>Welcome to Archivist</h1>
      <p className="welcome-subtitle">Back up your first folder in 30 seconds</p>
      <p className="welcome-description">
        Archivist stores your files on a decentralized network.
        No cloud providers. No subscriptions. Your data, your control.
      </p>
      <div className="welcome-actions">
        <button className="btn-primary btn-large" onClick={onGetStarted}>
          Get Started
        </button>
        <button className="btn-text" onClick={onSkip}>
          Skip for now
        </button>
      </div>
    </div>
  );
}

// Node starting screen component
interface NodeStartingScreenProps {
  isRunning: boolean;
  nodeReady: boolean;
  error: string | null;
}

function NodeStartingScreen({ isRunning, nodeReady, error }: NodeStartingScreenProps) {
  return (
    <div className="onboarding-screen node-starting-screen">
      <div className="node-status-icon">
        {error ? (
          <div className="status-icon error">
            <svg viewBox="0 0 24 24" width="48" height="48">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        ) : nodeReady ? (
          <div className="status-icon ready">
            <svg viewBox="0 0 24 24" width="48" height="48">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M8 12l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        ) : (
          <div className="status-icon loading">
            <div className="spinner" />
          </div>
        )}
      </div>
      <h2>{error ? 'Connection Error' : nodeReady ? 'Node Ready!' : 'Starting Node...'}</h2>
      <p className="node-status-text">
        {error ? (
          error
        ) : nodeReady ? (
          'Your node is connected to the network'
        ) : isRunning ? (
          'Connecting to the decentralized network...'
        ) : (
          'Initializing your local node...'
        )}
      </p>
      {!error && !nodeReady && (
        <div className="progress-bar">
          <div className="progress-bar-fill indeterminate" />
        </div>
      )}
    </div>
  );
}

// Folder selection screen component
interface FolderSelectScreenProps {
  onQuickBackup: () => void;
  onChooseFolder: () => void;
  isCreatingFolder: boolean;
  error: string | null;
}

function FolderSelectScreen({ onQuickBackup, onChooseFolder, isCreatingFolder, error }: FolderSelectScreenProps) {
  return (
    <div className="onboarding-screen folder-select-screen">
      <h2>Choose Your First Backup</h2>
      <p className="folder-select-description">
        Select a folder to start backing up. We'll watch it for changes and sync automatically.
      </p>

      {error && (
        <div className="onboarding-error">
          {error}
        </div>
      )}

      <div className="folder-options">
        <button
          className="folder-option recommended"
          onClick={onQuickBackup}
          disabled={isCreatingFolder}
        >
          <div className="folder-option-icon">
            <svg viewBox="0 0 24 24" width="32" height="32">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" fill="none" stroke="currentColor" strokeWidth="2" />
              <polyline points="13 2 13 9 20 9" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
          <div className="folder-option-content">
            <span className="folder-option-title">Quick Backup</span>
            <span className="folder-option-subtitle">Creates "Archivist Quickstart" in Documents</span>
            <span className="recommended-badge">Recommended</span>
          </div>
          {isCreatingFolder && <div className="mini-spinner" />}
        </button>

        <button
          className="folder-option"
          onClick={onChooseFolder}
          disabled={isCreatingFolder}
        >
          <div className="folder-option-icon">
            <svg viewBox="0 0 24 24" width="32" height="32">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
          <div className="folder-option-content">
            <span className="folder-option-title">Choose Folder</span>
            <span className="folder-option-subtitle">Select an existing folder to backup</span>
          </div>
        </button>
      </div>
    </div>
  );
}

// Syncing screen component
interface SyncingScreenProps {
  syncProgress: 'connecting' | 'watching' | 'syncing' | 'complete';
  folderPath: string | null;
  firstFileCid: string | null;
  onComplete: () => void;
}

function SyncingScreen({ syncProgress, folderPath, firstFileCid, onComplete }: SyncingScreenProps) {
  const steps = [
    { id: 'connecting', label: 'Connecting to network' },
    { id: 'watching', label: 'Watching folder' },
    { id: 'syncing', label: 'Syncing files' },
    { id: 'complete', label: 'Backup complete!' },
  ];

  const currentIndex = steps.findIndex(s => s.id === syncProgress);

  return (
    <div className="onboarding-screen syncing-screen">
      <h2>Setting Up Your Backup</h2>

      {folderPath && (
        <p className="syncing-folder-path">
          {folderPath}
        </p>
      )}

      <div className="sync-timeline">
        {steps.map((step, index) => (
          <div
            key={step.id}
            className={`timeline-step ${index <= currentIndex ? 'active' : ''} ${index < currentIndex ? 'completed' : ''}`}
          >
            <div className="timeline-dot">
              {index < currentIndex ? (
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : index === currentIndex && syncProgress !== 'complete' ? (
                <div className="mini-spinner" />
              ) : (
                <div className="dot-inner" />
              )}
            </div>
            <span className="timeline-label">{step.label}</span>
          </div>
        ))}
      </div>

      {syncProgress === 'complete' && (
        <div className="sync-complete-message">
          <div className="success-icon">
            <svg viewBox="0 0 24 24" width="48" height="48">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M8 12l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p>Your folder is now being backed up to the decentralized network!</p>
          {firstFileCid && firstFileCid !== 'synced' && (
            <div className="first-cid">
              <span className="cid-label">First file CID:</span>
              <code className="cid-value">{firstFileCid}</code>
            </div>
          )}
          <button className="btn-primary btn-large" onClick={onComplete}>
            Continue to Dashboard
          </button>
        </div>
      )}
    </div>
  );
}

export default Onboarding;
