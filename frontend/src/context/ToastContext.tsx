import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "../lib/format";

type ToastKind = "success" | "error" | "info" | "warning";
interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastContextValue {
  push: (kind: ToastKind, title: string, description?: string) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

const STYLES: Record<ToastKind, string> = {
  success: "text-positive border-positive/25",
  error: "text-danger border-danger/25",
  info: "text-accent border-accent/25",
  warning: "text-warning border-warning/25",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const timers = useRef<number[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, title: string, description?: string) => {
      const id = ++counter.current;
      setToasts((current) => [...current.slice(-4), { id, kind, title, description }]);
      const timer = window.setTimeout(() => remove(id), 5000);
      timers.current.push(timer);
    },
    [remove],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (title, description) => push("success", title, description),
      error: (title, description) => push("error", title, description),
      info: (title, description) => push("info", title, description),
      warning: (title, description) => push("warning", title, description),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-3 top-3 z-[100] flex w-[calc(100%-24px)] max-w-sm flex-col gap-2 sm:right-5 sm:top-5">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.kind];
          return (
            <div
              key={toast.id}
              role="status"
              className={cn(
                "pointer-events-auto flex animate-fade-up items-start gap-3 rounded-xl border bg-panel/95 p-3.5 shadow-card backdrop-blur-xl",
                STYLES[toast.kind],
              )}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-ink">{toast.title}</p>
                {toast.description && <p className="mt-1 text-[11px] leading-relaxed text-muted">{toast.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => remove(toast.id)}
                className="rounded-md p-1 text-muted transition hover:bg-line/10 hover:text-ink"
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
