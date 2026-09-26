import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import ToastContainer from './ToastContainer';

const ToastContext = createContext(null);

const DEFAULT_DURATION = 4000;

let toastCounter = 0;
const nextId = () => {
  toastCounter += 1;
  return `toast-${toastCounter}`;
};

/**
 * ToastProvider (Phase F2A & Phase F-FIX).
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success('Saved successfully');
 *   toast.error('An error occurred');
 *   toast.warning('Check your input');
 *   toast.info('Notification');
 *   toast.showToast('Custom message', { type: 'info' });
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());
  const mountedRef = useRef(true);

  const clearTimer = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const dismissToast = useCallback((id) => {
    clearTimer(id);
    if (mountedRef.current) {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }
  }, [clearTimer]);

  const showToast = useCallback((message, options = {}) => {
    const id = nextId();
    const duration = options.duration ?? DEFAULT_DURATION;

    if (mountedRef.current) {
      setToasts((prev) => [...prev, { id, message, type: options.type || 'info' }]);
    }

    if (duration > 0) {
      const timer = setTimeout(() => dismissToast(id), duration);
      timersRef.current.set(id, timer);
    }

    return id;
  }, [dismissToast]);

  // Cleanup all pending timers on unmount; guard against post-unmount setState.
  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current; // stable copy for cleanup
    return () => {
      mountedRef.current = false;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const success = useCallback((message, options) => showToast(message, { ...options, type: 'success' }), [showToast]);
  const error = useCallback((message, options) => showToast(message, { ...options, type: 'error' }), [showToast]);
  const warning = useCallback((message, options) => showToast(message, { ...options, type: 'warning' }), [showToast]);
  const info = useCallback((message, options) => showToast(message, { ...options, type: 'info' }), [showToast]);

  const value = useMemo(
    () => ({
      showToast,
      dismissToast,
      success,
      error,
      warning,
      info,
    }),
    [showToast, dismissToast, success, error, warning, info]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

