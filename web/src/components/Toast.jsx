import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Bell, CheckCircle2, Info, X, XCircle } from 'lucide-react';

const ToastContext = createContext(null);

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  notification: Bell,
};

const STYLES = {
  success: 'border-emerald-200 bg-white text-slate-900 [&_svg.toast-icon]:text-emerald-600',
  error: 'border-red-200 bg-white text-slate-900 [&_svg.toast-icon]:text-red-600',
  warning: 'border-amber-200 bg-white text-slate-900 [&_svg.toast-icon]:text-amber-600',
  info: 'border-slate-200 bg-white text-slate-900 [&_svg.toast-icon]:text-indigo-600',
  notification: 'border-indigo-200 bg-white text-slate-900 [&_svg.toast-icon]:text-indigo-600',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (type, title, body, opts = {}) => {
      const id = ++idRef.current;
      setToasts((list) => [...list.slice(-4), { id, type, title, body, onClick: opts.onClick }]);
      const duration = opts.duration ?? (type === 'error' ? 7000 : 4500);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss],
  );

  const api = useMemo(
    () => ({
      success: (title, body, opts) => push('success', title, body, opts),
      error: (title, body, opts) => push('error', title, body, opts),
      warning: (title, body, opts) => push('warning', title, body, opts),
      info: (title, body, opts) => push('info', title, body, opts),
      notification: (title, body, opts) => push('notification', title, body, opts),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 top-3 z-[1000] flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:right-4 sm:top-4 sm:items-end"
      >
        {toasts.map((t) => {
          const Icon = ICONS[t.type] || Info;
          return (
            <div
              key={t.id}
              role={t.type === 'error' ? 'alert' : 'status'}
              className={clsx(
                'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-3 shadow-lg',
                STYLES[t.type],
                t.onClick && 'cursor-pointer',
              )}
              onClick={() => {
                if (t.onClick) {
                  t.onClick();
                  dismiss(t.id);
                }
              }}
            >
              <Icon className="toast-icon mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{t.title}</p>
                {t.body && <p className="mt-0.5 break-words text-sm text-slate-600">{t.body}</p>}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss(t.id);
                }}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
