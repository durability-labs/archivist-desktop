import { useCallback, useEffect, useState } from 'react';
import '../styles/Toast.css';

export interface ToastData {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  details?: string;
  timestamp: number;
}

const ICONS: Record<ToastData['type'], string> = {
  success: '\u2713', // ✓
  error: '\u2715',   // ✕
  warning: '\u26A0', // ⚠
  info: '\u2139',    // ℹ
};

interface ToastItemProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [exiting, setExiting] = useState(false);

  const handleDismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 200);
  }, [onDismiss, toast.id]);

  useEffect(() => {
    if (toast.type === 'error') return; // errors are sticky

    const duration = toast.type === 'warning' ? 10000 : 5000;
    const timer = setTimeout(() => handleDismiss(), duration);
    return () => clearTimeout(timer);
  }, [toast.type, handleDismiss]);

  return (
    <div
      className={`toast-item toast-${toast.type}${exiting ? ' toast-exiting' : ''}`}
      role="alert"
    >
      <span className="toast-icon">{ICONS[toast.type]}</span>
      <div className="toast-content">
        <div className="toast-message">{toast.message}</div>
        {toast.details && <div className="toast-details">{toast.details}</div>}
      </div>
      <button
        className="toast-dismiss"
        onClick={handleDismiss}
        aria-label="Dismiss notification"
      >
        {'\u2715'}
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
