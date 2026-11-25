import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Check, ChevronDown, Copy, Loader2, RefreshCw, X } from "lucide-react";
import { cn, severityMeta, statusMeta } from "../lib/format";
import type { DataSource, Severity, ServerStatus } from "../types";

/* -------------------------------------------------------------------------- */
/* Buttons                                                                     */
/* -------------------------------------------------------------------------- */
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  loading?: boolean;
  icon?: ReactNode;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-danger",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(BUTTON_VARIANTS[variant], size === "sm" && "h-8 px-2.5 text-[11px]", className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: "ghost" | "secondary";
}

export function IconButton({ label, variant = "ghost", className, children, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted transition hover:bg-panel/70 hover:text-ink",
        variant === "secondary" && "border border-line/15 bg-panel/50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Status & data badges                                                        */
/* -------------------------------------------------------------------------- */
export function StatusBadge({ status, dot = true }: { status: ServerStatus | string; dot?: boolean }) {
  const meta = statusMeta(status);
  return (
    <span className={cn("chip", meta.className)}>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />}
      {meta.label}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity | string }) {
  const meta = severityMeta(severity);
  return <span className={cn("chip", meta.className)}>{meta.label}</span>;
}

export function ModeBadge({ mode, compact = false }: { mode: "demo" | "live"; compact?: boolean }) {
  return mode === "demo" ? (
    <span className="chip border-warning/30 bg-warning/10 text-warning" title="All values are simulated demo telemetry.">
      <span className="h-1.5 w-1.5 rounded-full bg-warning" />
      {compact ? "Demo" : "Demo data"}
    </span>
  ) : (
    <span className="chip border-positive/30 bg-positive/10 text-positive" title="Values come from live agent heartbeats.">
      <span className="h-1.5 w-1.5 rounded-full bg-positive" />
      {compact ? "Live" : "Live data"}
    </span>
  );
}

export function DataSourceBadge({ source }: { source: DataSource | "all" }) {
  if (source === "all") {
    return <span className="chip border-line/20 bg-line/5 text-muted">All sources</span>;
  }
  return <ModeBadge mode={source === "simulated" ? "demo" : "live"} compact />;
}

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("rounded-md border border-line/15 bg-line/5 px-1.5 py-0.5 text-[10px] font-medium text-muted", className)}>
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Layout primitives                                                           */
/* -------------------------------------------------------------------------- */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <h1 className="text-xl font-semibold tracking-[-0.03em] text-ink sm:text-[24px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted sm:text-[13px]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[11px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-52" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-[104px] rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-[310px] rounded-2xl" />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-accent", className)} />;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full border border-danger/20 bg-danger/10 text-danger">
        <AlertCircle className="h-5 w-5" />
      </span>
      <div>
        <p className="text-sm font-semibold text-ink">Unable to load this view</p>
        <p className="mt-1 max-w-md text-xs text-muted">{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      {icon && (
        <span className="mb-3 grid h-11 w-11 place-items-center rounded-full border border-line/15 bg-line/5 text-muted">
          {icon}
        </span>
      )}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Form controls                                                               */
/* -------------------------------------------------------------------------- */
export function FormField({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
      {error ? (
        <p className="mt-1.5 text-[11px] text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[10px] leading-relaxed text-muted/80">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("input", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("textarea", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn("input appearance-none pr-8", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 rounded-full border transition",
        checked ? "border-accent/40 bg-accent/80" : "border-line/25 bg-line/15",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all",
          checked ? "left-[18px]" : "left-0.5",
        )}
      />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Tabs                                                                        */
/* -------------------------------------------------------------------------- */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={cn("inline-flex items-center gap-0.5 rounded-xl border border-line/15 bg-canvas/35 p-0.5", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[10px] font-medium transition",
            size === "sm" ? "h-7 px-2.5 text-[10px]" : "h-8 px-3 text-[11px]",
            value === option.value
              ? "bg-panel text-ink shadow-sm ring-1 ring-line/15"
              : "text-muted hover:text-ink",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Modal & drawer                                                              */
/* -------------------------------------------------------------------------- */
function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  useEscape(open, onClose);
  if (!open) return null;
  const width = size === "sm" ? "max-w-md" : size === "lg" ? "max-w-3xl" : "max-w-xl";
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 backdrop-blur-sm sm:items-center sm:p-5">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "card relative z-10 max-h-[92vh] w-full animate-fade-up overflow-y-auto rounded-b-none p-5 sm:rounded-2xl",
          width,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">{title}</h2>
            {description && <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>}
          </div>
          <IconButton label="Close dialog" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        {children}
        {footer && <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-line/10 pt-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "max-w-xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "absolute inset-y-0 right-0 flex w-full animate-fade-up flex-col border-l border-line/15 bg-canvas/95 shadow-2xl",
          width,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line/10 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-[-0.02em] text-ink">{title}</h2>
            {description && <p className="mt-1 text-xs text-muted">{description}</p>}
          </div>
          <IconButton label="Close panel" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line/10 px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  loading = false,
  tone = "danger",
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  loading?: boolean;
  tone?: "danger" | "primary";
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="rounded-xl border border-line/15 bg-canvas/30 p-3 text-[11px] leading-relaxed text-muted">
        This action is recorded in the API audit log and takes effect immediately.
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                        */
/* -------------------------------------------------------------------------- */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button type="button" onClick={copy} className="btn-secondary h-8 px-2.5 text-[11px]">
      {copied ? <Check className="h-3.5 w-3.5 text-positive" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function ProgressBar({
  value,
  color,
  className,
  height = "h-1.5",
}: {
  value: number;
  color?: string;
  className?: string;
  height?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-full bg-line/10", height, className)}>
      <div
        className={cn("h-full rounded-full transition-all duration-700", !color && "bg-accent")}
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }}
      />
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/8 py-2.5 last:border-0">
      <span className="text-[11px] text-muted">{label}</span>
      <span className="text-right text-[11px] font-medium text-ink">{children}</span>
    </div>
  );
}

export function LinkedInput({
  icon,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { icon: ReactElement }) {
  const id = useId();
  return (
    <div className="relative">
      {cloneElement(icon, { className: "pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" } as never)}
      <input id={id} className="input pl-9" {...props} />
    </div>
  );
}
