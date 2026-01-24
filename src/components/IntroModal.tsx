import { useState, useEffect, useRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveResource } from '@tauri-apps/api/path';
import '../styles/IntroModal.css';

const INTRO_SHOWN_KEY = 'archivist_intro_shown';

interface IntroModalProps {
  onClose: () => void;
}

export function IntroModal({ onClose }: IntroModalProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // Check if intro has been shown before
    const hasShown = localStorage.getItem(INTRO_SHOWN_KEY);

    if (!hasShown) {
      setIsVisible(true);

      // Resolve the video path for production builds
      resolveResource('intro.mp4')
        .then((resourcePath) => {
          const src = convertFileSrc(resourcePath);
          setVideoSrc(src);
        })
        .catch((error) => {
          console.error('Failed to resolve intro video path:', error);
          // Fallback to public path for dev mode
          setVideoSrc('/intro.mp4');
        });
    } else {
      onClose();
    }
  }, [onClose]);

  // Auto-play video when src is set
  useEffect(() => {
    if (videoSrc && videoRef.current) {
      videoRef.current.play().catch((error) => {
        console.error('Failed to auto-play intro video:', error);
      });
    }
  }, [videoSrc]);

  const handleClose = () => {
    // Mark as shown
    localStorage.setItem(INTRO_SHOWN_KEY, 'true');
    setIsVisible(false);
    onClose();
  };

  const handleSkip = () => {
    // Pause video and close
    if (videoRef.current) {
      videoRef.current.pause();
    }
    handleClose();
  };

  const handleVideoEnd = () => {
    // Auto-close when video ends
    handleClose();
  };

  if (!isVisible) {
    return null;
  }

  // Don't render until video source is ready
  if (!videoSrc) {
    return null;
  }

  return (
    <div className="intro-modal-overlay" onClick={handleSkip}>
      <div className="intro-modal-content" onClick={(e) => e.stopPropagation()}>
        <video
          ref={videoRef}
          className="intro-video"
          src={videoSrc}
          onEnded={handleVideoEnd}
          controls
          autoPlay
        >
          Your browser does not support the video tag.
        </video>

        <div className="intro-modal-actions">
          <button className="btn-primary" onClick={handleClose}>
            Get Started
          </button>
          <button className="btn-secondary" onClick={handleSkip}>
            Skip Intro
          </button>
        </div>
      </div>
    </div>
  );
}
