"use client";

import { useState, createContext, useContext, useCallback, useRef } from "react";
import { CheckCircle, XCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextType {
  toast: (opts: Omit<Toast, "id">) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const icons: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const iconColors: Record<ToastType, string> = {
  success: "text-emerald",
  error: "text-rose",
  warning: "text-amber",
  info: "text-sky",
};

const EXIT_DURATION = 200;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    setRemoving((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, EXIT_DURATION);
  }, []);

  const addToast = useCallback((opts: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { ...opts, id }]);
    const timer = setTimeout(() => removeToast(id), opts.duration || 4000);
    timersRef.current.set(id, timer);
  }, [removeToast]);

  const handleDismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    removeToast(id);
  }, [removeToast]);

  const ctx: ToastContextType = {
    toast: addToast,
    success: (title, message) => addToast({ type: "success", title, message }),
    error: (title, message) => addToast({ type: "error", title, message }),
    warning: (title, message) => addToast({ type: "warning", title, message }),
    info: (title, message) => addToast({ type: "info", title, message }),
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div role="status" aria-live="polite" className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm">
        {toasts.map((t) => {
          const Icon = icons[t.type];
          const isRemoving = removing.has(t.id);
          return (
            <div
              key={t.id}
              className={cn(
                "flex items-start gap-3 rounded-2xl p-4 shadow-[var(--shadow-overlay)] glass",
                isRemoving
                  ? "animate-out fade-out slide-out-to-right-5 duration-200"
                  : "animate-in slide-in-from-right-5 fade-in duration-300",
              )}
            >
              <Icon className={cn("w-5 h-5 flex-shrink-0 mt-0.5", iconColors[t.type])} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink">{t.title}</p>
                {t.message && <p className="text-xs mt-0.5 text-ink-secondary">{t.message}</p>}
              </div>
              <button
                onClick={() => handleDismiss(t.id)}
                className="flex-shrink-0 text-ink-tertiary hover:text-ink transition-colors"
                aria-label="Dismiss notification"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
