/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ToastContainer, type ToastData } from '../components/Toast';

const MAX_TOASTS = 5;

interface ToastActions {
  success: (message: string) => void;
  error: (message: string, details?: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const ToastContext = createContext<ToastActions | null>(null);

let toastCounter = 0;

function generateId(): string {
  toastCounter += 1;
  return `toast-${Date.now()}-${toastCounter}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((type: ToastData['type'], message: string, details?: string) => {
    const toast: ToastData = {
      id: generateId(),
      type,
      message,
      details,
      timestamp: Date.now(),
    };

    setToasts((prev) => {
      const next = [...prev, toast];
      // Keep only the newest MAX_TOASTS
      if (next.length > MAX_TOASTS) {
        return next.slice(next.length - MAX_TOASTS);
      }
      return next;
    });
  }, []);

  const actions = useMemo<ToastActions>(() => ({
    success: (message: string) => addToast('success', message),
    error: (message: string, details?: string) => addToast('error', message, details),
    info: (message: string) => addToast('info', message),
    warning: (message: string) => addToast('warning', message),
  }), [addToast]);

  return (
    <ToastContext.Provider value={actions}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastActions {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
