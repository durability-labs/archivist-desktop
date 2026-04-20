import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNode } from '../hooks/useNode';
import { useSync } from '../hooks/useSync';
import { useOnboarding, OnboardingStep } from '../hooks/useOnboarding';
import { open } from '@tauri-apps/plugin-dialog';
import { resolveResource } from '@tauri-apps/api/path';
import { readFile } from '@tauri-apps/plugin-fs';
import '../styles/Onboarding.css';



interface OnboardingProps {
  onComplete: () => void;
  startMusic: () => void;
}

function Onboarding({ onComplete, startMusic }: OnboardingProps) {
  const {
    currentStep,
    setStep,
    isFirstRun,
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

  // Auto-start node when entering 'node-starting' step.
  //
  // If a wallet was created, handleWalletCreated already called
  // unlock_wallet_and_restart (which restarts with --persistence). This
  // effect only needs to handle the case where the user SKIPPED wallet
  // creation and the node isn't running yet.
  useEffect(() => {
    if (currentStep === 'node-starting' && !isRunning && !isStartingNode) {
      setIsStartingNode(true);
      startNode()
        .catch((e) => {
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          setIsStartingNode(false);
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

  // Handle "Get Started":
  //   - First-run user (no completion flag): continue to wallet setup.
  //   - Return user: dismiss onboarding and redirect to Dashboard. The splash
  //     + disclaimer + welcome cards play every launch, but setup steps stay
  //     first-run-only so returning users don't redo wallet/folder choice.
  const handleGetStarted = useCallback(() => {
    if (isFirstRun) {
      setStep('wallet-setup');
    } else {
      onComplete();
    }
  }, [isFirstRun, setStep, onComplete]);

  // Handle wallet creation during onboarding.
  // Call unlock_wallet_and_restart IMMEDIATELY after generate_wallet — don't
  // defer to a useEffect, because React's batching means the effect fires
  // with stale useState values (walletCreated=false) while the external store
  // update (currentStep='node-starting') is already applied. This race caused
  // the node to stay running without marketplace flags.
  const handleWalletCreated = useCallback(async (password: string) => {
    setError(null);
    try {
      // Try generating a new wallet. If one already exists (e.g. user reset
      // onboarding after a previous run), skip generation and just unlock +
      // restart with marketplace flags using the entered password.
      try {
        await invoke('generate_wallet', { password });
      } catch (genErr) {
        const msg = String(genErr);
        if (!msg.includes('already exists')) {
          throw genErr; // real error — propagate
        }
        // Wallet already exists — that's fine, proceed to unlock + restart.
      }

      // Restart the node with marketplace flags. The node is likely already
      // running from auto_start, so unlock_wallet_and_restart injects the
      // wallet credentials + restarts with --persistence.
      await invoke('unlock_wallet_and_restart', { password });

      setStep('node-starting');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e; // re-throw so WalletSetupScreen resets its `creating` state
    }
  }, [setStep, setError]);

  // Handle wallet skip during onboarding
  const handleWalletSkip = useCallback(() => {
    setStep('node-starting');
  }, [setStep]);

  // Handle "Quick Backup" click
  const handleQuickBackup = useCallback(async () => {
    setIsCreatingFolder(true);
    setError(null);
    try {
      const path = await createQuickstartFolder();
      setQuickBackupPath(path);
      try {
        await addWatchFolder(path);
      } catch (watchErr) {
        // If folder is already being watched, that's fine - proceed anyway
        const errMsg = watchErr instanceof Error ? watchErr.message : String(watchErr);
        if (!errMsg.includes('already being watched')) {
          throw watchErr;
        }
        // Folder already watched - just continue to syncing
      }
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

  // Handle splash screen completion (video ended or CSS fallback)
  const handleSplashComplete = useCallback(() => {
    setStep('disclaimer');
    // Start background music when transitioning past splash
    startMusic();
  }, [setStep, startMusic]);

  // Handle disclaimer acknowledgment
  const handleDisclaimerAccept = useCallback(() => {
    setStep('welcome');
  }, [setStep]);

  // Render current step
  const renderStep = () => {
    switch (currentStep) {
      case 'splash':
        return <SplashScreen onComplete={handleSplashComplete} />;
      case 'disclaimer':
        return <DisclaimerScreen onAccept={handleDisclaimerAccept} />;
      case 'welcome':
        return <WelcomeScreen onGetStarted={handleGetStarted} />;
      case 'wallet-setup':
        return <WalletSetupScreen onCreateWallet={handleWalletCreated} onSkip={handleWalletSkip} error={error} />;
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
    return <SplashScreen onComplete={handleSplashComplete} />;
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
  const steps: OnboardingStep[] = ['disclaimer', 'welcome', 'wallet-setup', 'node-starting', 'folder-select', 'syncing'];
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

// Splash screen component - plays branding video.
// The intro is intentionally unskippable: the user must wait for the video to
// end (or the CSS fallback animation to complete) and then click Continue.
interface SplashScreenProps {
  onComplete: () => void;
}

function SplashScreen({ onComplete }: SplashScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [showPlayOverlay, setShowPlayOverlay] = useState(false);
  const [playbackStarted, setPlaybackStarted] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const lastProgressTime = useRef<number>(0);
  const stallCheckInterval = useRef<number | null>(null);

  // Determine if we should attempt video or use CSS fallback directly
  useEffect(() => {
    let cancelled = false;

    const loadVideoResource = async () => {
      const isTauri = !!(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

      if (!isTauri) {
        // Dev mode - use standard path
        setVideoUrl('/intro.mp4');
        return;
      }

      // Tauri - load video via blob URL (asset:// protocol doesn't work for video)
      try {
        // Try WebM first on Linux (WebKitGTK/GStreamer handles VP8/VP9 more reliably than H.264)
        const isLinux = navigator.userAgent.toLowerCase().includes('linux');
        const videoFile = isLinux ? 'intro.webm' : 'intro.mp4';
        const mimeType = isLinux ? 'video/webm' : 'video/mp4';

        console.log(`SplashScreen: Loading video resource: ${videoFile}`);
        const videoPath = await resolveResource(videoFile);
        console.log(`SplashScreen: Resolved path: ${videoPath}`);

        const fileData = await readFile(videoPath);
        console.log(`SplashScreen: Read ${fileData.byteLength} bytes`);

        const blob = new Blob([fileData], { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);
        console.log(`SplashScreen: Created blob URL`);

        if (!cancelled) {
          blobUrlRef.current = blobUrl;
          setVideoUrl(blobUrl);
        } else {
          URL.revokeObjectURL(blobUrl);
        }
      } catch (error) {
        console.error('SplashScreen: Failed to load intro video:', error);
        if (!cancelled) {
          // Fall back to CSS animation
          setShowFallback(true);
        }
      }
    };

    loadVideoResource();

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  // Clean up stall check interval on unmount
  useEffect(() => {
    return () => {
      if (stallCheckInterval.current) {
        clearInterval(stallCheckInterval.current);
      }
    };
  }, []);

  // Show play overlay when video data is ready
  useEffect(() => {
    if (videoLoaded && !showFallback) {
      setShowPlayOverlay(true);
    }
  }, [videoLoaded, showFallback]);

  // Handle play button click - start video with sound
  const handlePlayClick = useCallback(() => {
    setShowPlayOverlay(false);
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
      videoRef.current.play()
        .then(() => {
          setPlaybackStarted(true);
          lastProgressTime.current = Date.now();
        })
        .catch((err) => {
          console.error('Video play failed:', err);
          setShowFallback(true);
        });
    }
  }, [isMuted]);

  // Toggle mute
  const handleToggleMute = useCallback(() => {
    setIsMuted(prev => {
      const newMuted = !prev;
      if (videoRef.current) {
        videoRef.current.muted = newMuted;
      }
      return newMuted;
    });
  }, []);

  // Handle video data loaded (first frame available)
  const handleLoadedData = useCallback(() => {
    setVideoLoaded(true);
    lastProgressTime.current = Date.now();
  }, []);

  // Handle video fully buffered and ready
  const handleCanPlayThrough = useCallback(() => {
    setVideoLoaded(true);
    lastProgressTime.current = Date.now();
  }, []);

  // Track video progress to detect stalls
  const handleTimeUpdate = useCallback(() => {
    lastProgressTime.current = Date.now();
  }, []);

  // Handle video error - show CSS fallback animation
  const handleVideoError = useCallback(() => {
    setShowFallback(true);
  }, []);

  // Start stall detection when video is loaded
  useEffect(() => {
    if (videoLoaded && playbackStarted && !showFallback) {
      // Check every 2 seconds if video has progressed
      stallCheckInterval.current = window.setInterval(() => {
        const timeSinceProgress = Date.now() - lastProgressTime.current;
        // If no progress for 3 seconds, video is stuck - show fallback
        if (timeSinceProgress > 3000) {
          console.log('SplashScreen: Video stuck (no progress for 3s), showing fallback');
          setShowFallback(true);
          if (stallCheckInterval.current) {
            clearInterval(stallCheckInterval.current);
          }
        }
      }, 2000);

      return () => {
        if (stallCheckInterval.current) {
          clearInterval(stallCheckInterval.current);
        }
      };
    }
  }, [videoLoaded, playbackStarted, showFallback]);

  // Auto-advance after animation completes (for fallback)
  useEffect(() => {
    if (showFallback) {
      const timer = setTimeout(onComplete, 3000); // 3 second animation
      return () => clearTimeout(timer);
    }
  }, [showFallback, onComplete]);

  // Timeout: if video hasn't loaded after 10 seconds, show fallback
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!videoLoaded && !showFallback) {
        setShowFallback(true);
      }
    }, 10000);
    return () => clearTimeout(timeout);
  }, [videoLoaded, showFallback]);

  // CSS-animated fallback splash
  if (showFallback) {
    return (
      <div className="splash-screen splash-fallback">
        <div className="splash-fallback-content">
          <div className="splash-logo-animated">
            <svg viewBox="0 0 400 400" width="120" height="120" className="splash-icon">
              <g transform="translate(0,400) scale(0.1,-0.1)" fill="currentColor" stroke="none">
                <path d="M1750 3254 c-135 -79 -371 -217 -525 -305 -154 -89 -310 -180 -348
                  -201 l-67 -40 2 -691 3 -690 280 -165 c154 -90 294 -172 310 -182 55 -31 499
                  -292 548 -321 26 -16 49 -29 52 -29 2 0 60 33 127 73 68 41 245 145 393 232
                  149 87 359 210 467 274 l197 116 1 665 c0 366 3 675 6 687 7 25 25 12 -246
                  170 -91 52 -277 161 -415 241 -393 228 -538 312 -539 311 -1 0 -111 -66 -246
                  -145z m308 -306 c22 -40 113 -215 202 -388 89 -173 197 -380 240 -460 146
                  -274 300 -579 300 -594 0 -29 -17 -24 -106 28 -484 288 -687 406 -698 406 -7
                  0 -187 -102 -400 -226 -213 -124 -391 -223 -394 -219 -6 6 64 150 151 310 23
                  44 83 157 131 250 49 94 123 235 166 315 42 80 112 213 155 295 43 83 90 173
                  105 200 15 28 39 74 54 103 14 28 33 52 40 52 8 0 32 -33 54 -72z"/>
                <g transform="translate(1988,2200) scale(0.75) translate(-1988,-2200)">
                  <path d="M1890 2712 c-62 -119 -168 -320 -235 -447 -67 -126 -153 -288 -190
                    -360 -38 -71 -88 -166 -112 -209 -24 -43 -42 -80 -40 -82 1 -2 79 42 172 98
                    395 234 485 287 503 292 13 5 118 -53 353 -195 184 -110 340 -205 347 -211 6
                    -6 12 -7 12 -4 0 7 -86 171 -120 231 -10 17 -57 107 -105 200 -49 94 -114 217
                    -144 275 -31 58 -114 220 -185 360 -71 140 -132 258 -135 262 -4 5 -58 -90
                    -121 -210z"/>
                </g>
              </g>
            </svg>
          </div>
          <h1 className="splash-title">Archivist</h1>
          <p className="splash-tagline">Decentralized Storage</p>
        </div>
      </div>
    );
  }

  // Show loading state while resolving video URL
  if (!videoUrl) {
    return (
      <div className="splash-screen splash-fallback">
        <div className="splash-fallback-content">
          <div className="splash-logo-animated">
            <svg viewBox="0 0 400 400" width="120" height="120" className="splash-icon">
              <g transform="translate(0,400) scale(0.1,-0.1)" fill="currentColor" stroke="none">
                <path d="M1750 3254 c-135 -79 -371 -217 -525 -305 -154 -89 -310 -180 -348
                  -201 l-67 -40 2 -691 3 -690 280 -165 c154 -90 294 -172 310 -182 55 -31 499
                  -292 548 -321 26 -16 49 -29 52 -29 2 0 60 33 127 73 68 41 245 145 393 232
                  149 87 359 210 467 274 l197 116 1 665 c0 366 3 675 6 687 7 25 25 12 -246
                  170 -91 52 -277 161 -415 241 -393 228 -538 312 -539 311 -1 0 -111 -66 -246
                  -145z m308 -306 c22 -40 113 -215 202 -388 89 -173 197 -380 240 -460 146
                  -274 300 -579 300 -594 0 -29 -17 -24 -106 28 -484 288 -687 406 -698 406 -7
                  0 -187 -102 -400 -226 -213 -124 -391 -223 -394 -219 -6 6 64 150 151 310 23
                  44 83 157 131 250 49 94 123 235 166 315 42 80 112 213 155 295 43 83 90 173
                  105 200 15 28 39 74 54 103 14 28 33 52 40 52 8 0 32 -33 54 -72z"/>
                <g transform="translate(1988,2200) scale(0.75) translate(-1988,-2200)">
                  <path d="M1890 2712 c-62 -119 -168 -320 -235 -447 -67 -126 -153 -288 -190
                    -360 -38 -71 -88 -166 -112 -209 -24 -43 -42 -80 -40 -82 1 -2 79 42 172 98
                    395 234 485 287 503 292 13 5 118 -53 353 -195 184 -110 340 -205 347 -211 6
                    -6 12 -7 12 -4 0 7 -86 171 -120 231 -10 17 -57 107 -105 200 -49 94 -114 217
                    -144 275 -31 58 -114 220 -185 360 -71 140 -132 258 -135 262 -4 5 -58 -90
                    -121 -210z"/>
                </g>
              </g>
            </svg>
          </div>
        </div>
      </div>
    );
  }

  // Render video from resolved resource URL
  return (
    <div className="splash-screen">
      <video
        ref={videoRef}
        playsInline
        preload="auto"
        className="splash-video"
        onEnded={() => setVideoEnded(true)}
        onLoadedData={handleLoadedData}
        onCanPlayThrough={handleCanPlayThrough}
        onTimeUpdate={handleTimeUpdate}
        onError={handleVideoError}
        src={videoUrl}
      />
      {showPlayOverlay && (
        <div className="splash-play-overlay" onClick={handlePlayClick}>
          <div className="splash-play-button">
            <svg viewBox="0 0 24 24" width="64" height="64">
              <polygon points="5,3 19,12 5,21" fill="currentColor" />
            </svg>
          </div>
          <p className="splash-play-text">Click to play</p>
        </div>
      )}
      {videoEnded && (
        <div className="splash-continue-overlay">
          <button className="btn-primary btn-large" onClick={onComplete}>
            Continue
          </button>
        </div>
      )}
      {playbackStarted && (
        <button className="splash-mute" onClick={handleToggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
          {isMuted ? (
            <svg viewBox="0 0 24 24" width="24" height="24"><path d="M11 5L6 9H2v6h4l5 4V5z" fill="none" stroke="currentColor" strokeWidth="2" /><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" strokeWidth="2" /><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" strokeWidth="2" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="24" height="24"><path d="M11 5L6 9H2v6h4l5 4V5z" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
          )}
        </button>
      )}
    </div>
  );
}

// Disclaimer screen component
interface DisclaimerScreenProps {
  onAccept: () => void;
}

function DisclaimerScreen({ onAccept }: DisclaimerScreenProps) {
  return (
    <div className="onboarding-screen disclaimer-screen">
      <div className="disclaimer-warning-icon">
        <svg viewBox="0 0 24 24" width="48" height="48">
          <path d="M12 2L1 21h22L12 2z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="17" r="1" fill="currentColor" />
        </svg>
      </div>
      <h2 className="disclaimer-heading">Alpha Software — Pilot Program</h2>

      <div className="disclaimer-encryption-notice">
        <strong>No Encryption:</strong> The P2P protocol does not yet have basic encryption.
        Data stored and transferred on the network is not encrypted and may be accessible to other network participants.
      </div>

      <div className="disclaimer-content">
        <p>
          This software is in alpha stage and is part of the pilot program.
          Do not use this for mission-critical data or personal files that you cannot afford to lose.
        </p>
        <ul>
          <li>Data loss may occur due to bugs, incomplete features, or network issues</li>
          <li>There is no guarantee of data persistence or recovery</li>
          <li>Always maintain separate backups of important files</li>
          <li>This software is provided "as-is" without warranty of any kind</li>
          <li>VPN connections may interfere with P2P networking. For best results, disable your VPN or configure a custom announce IP in Settings</li>
        </ul>
      </div>

      <p className="disclaimer-acknowledgment">
        By using this software, you acknowledge and accept these risks.
      </p>

      <div className="welcome-actions">
        <button className="btn-primary btn-large" onClick={onAccept}>
          I Understand &amp; Accept
        </button>
      </div>
    </div>
  );
}

// Welcome screen component.
// Intentionally has no "Skip for now" option — the welcome card plays on every
// launch (not just first run), and offering a skip would contradict that.
interface WelcomeScreenProps {
  onGetStarted: () => void;
}

function WelcomeScreen({ onGetStarted }: WelcomeScreenProps) {
  return (
    <div className="onboarding-screen welcome-screen">
      <div className="welcome-icon">
        <svg viewBox="0 0 400 400" width="64" height="64">
          <g transform="translate(0,400) scale(0.1,-0.1)" fill="currentColor" stroke="none">
            <path d="M1750 3254 c-135 -79 -371 -217 -525 -305 -154 -89 -310 -180 -348
              -201 l-67 -40 2 -691 3 -690 280 -165 c154 -90 294 -172 310 -182 55 -31 499
              -292 548 -321 26 -16 49 -29 52 -29 2 0 60 33 127 73 68 41 245 145 393 232
              149 87 359 210 467 274 l197 116 1 665 c0 366 3 675 6 687 7 25 25 12 -246
              170 -91 52 -277 161 -415 241 -393 228 -538 312 -539 311 -1 0 -111 -66 -246
              -145z m308 -306 c22 -40 113 -215 202 -388 89 -173 197 -380 240 -460 146
              -274 300 -579 300 -594 0 -29 -17 -24 -106 28 -484 288 -687 406 -698 406 -7
              0 -187 -102 -400 -226 -213 -124 -391 -223 -394 -219 -6 6 64 150 151 310 23
              44 83 157 131 250 49 94 123 235 166 315 42 80 112 213 155 295 43 83 90 173
              105 200 15 28 39 74 54 103 14 28 33 52 40 52 8 0 32 -33 54 -72z"/>
            <g transform="translate(1988,2200) scale(0.75) translate(-1988,-2200)">
              <path d="M1890 2712 c-62 -119 -168 -320 -235 -447 -67 -126 -153 -288 -190
                -360 -38 -71 -88 -166 -112 -209 -24 -43 -42 -80 -40 -82 1 -2 79 42 172 98
                395 234 485 287 503 292 13 5 118 -53 353 -195 184 -110 340 -205 347 -211 6
                -6 12 -7 12 -4 0 7 -86 171 -120 231 -10 17 -57 107 -105 200 -49 94 -114 217
                -144 275 -31 58 -114 220 -185 360 -71 140 -132 258 -135 262 -4 5 -58 -90
                -121 -210z"/>
            </g>
          </g>
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

// Wallet setup screen component - optional wallet creation during onboarding
interface WalletSetupScreenProps {
  onCreateWallet: (password: string) => Promise<void>;
  onSkip: () => void;
  error: string | null;
}

function WalletSetupScreen({ onCreateWallet, onSkip, error }: WalletSetupScreenProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleCreate = async () => {
    setLocalError(null);
    if (password.length < 8) {
      setLocalError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setLocalError('Passwords do not match');
      return;
    }
    setCreating(true);
    try {
      await onCreateWallet(password);
    } catch {
      setCreating(false);
    }
  };

  return (
    <div className="onboarding-screen wallet-setup-screen">
      <div className="welcome-icon">
        <svg viewBox="0 0 24 24" width="48" height="48">
          <rect x="2" y="6" width="20" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M16 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" fill="currentColor" />
          <path d="M2 10h20" stroke="currentColor" strokeWidth="2" />
        </svg>
      </div>
      <h2>Set Up Your Wallet</h2>
      <p className="welcome-description">
        A wallet lets you use the Marketplace to create storage deals and earn tokens.
        You can always set this up later from the Wallet page.
      </p>

      {(error || localError) && (
        <div className="onboarding-error">
          {localError || error}
        </div>
      )}

      <div className="wallet-setup-form">
        <div className="wallet-setup-field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Choose a password (min 8 characters)"
            disabled={creating}
          />
        </div>
        <div className="wallet-setup-field">
          <label>Confirm Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter your password"
            disabled={creating}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
        </div>
      </div>

      <div className="welcome-actions">
        <button
          className="btn-primary btn-large"
          onClick={handleCreate}
          disabled={creating || !password || !confirmPassword}
        >
          {creating ? 'Creating Wallet...' : 'Create Wallet'}
        </button>
        <button className="btn-text" onClick={onSkip} disabled={creating}>
          Skip for now
        </button>
      </div>
    </div>
  );
}

export default Onboarding;
