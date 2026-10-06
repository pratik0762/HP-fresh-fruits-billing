import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';

// Lightweight toast notification system (no external library).
// Usage anywhere in the app:
//   const toast = useToast();
//   toast.success('Purchase saved');
//   toast.error('Could not save');

const ToastContext = createContext(null);

let toastId = 0;

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback((type, message) => {
    const id = ++toastId;
    setToasts(prev => [...prev.slice(-4), { id, type, message }]);
    // Auto-hide after 4 seconds
    timers.current.set(id, setTimeout(() => dismiss(id), 4000));
    return id;
  }, [dismiss]);

  const value = {
    success: (msg) => push('success', msg),
    error: (msg) => push('error', msg),
    info: (msg) => push('info', msg),
    warning: (msg) => push('warning', msg),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast viewport — bottom-left, stacks newest at bottom */}
      <div className="fixed bottom-4 left-4 z-[100] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none">
        {toasts.map(t => {
          const styles = {
            success: 'bg-emerald-600 text-white',
            error: 'bg-rose-600 text-white',
            info: 'bg-slate-800 text-white',
            warning: 'bg-amber-500 text-white'
          }[t.type];
          const Icon = {
            success: CheckCircle2,
            error: XCircle,
            info: Info,
            warning: AlertTriangle
          }[t.type];
          return (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto flex items-start gap-2.5 p-3.5 rounded-xl shadow-lg border border-black/5 ${styles} animate-toast-in`}
            >
              <Icon className="w-5 h-5 shrink-0 mt-0.5" />
              <span className="text-xs font-semibold leading-snug flex-1">{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                className="opacity-70 hover:opacity-100 transition shrink-0"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);
