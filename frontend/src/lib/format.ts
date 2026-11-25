import clsx, { type ClassValue } from "clsx";
import type { ServerStatus, Severity } from "../types";

export const cn = (...values: ClassValue[]) => clsx(values);

export const CHART = {
  accent: "#22d3ee",
  blue: "#3b82f6",
  violet: "#a78bfa",
  emerald: "#34d399",
  amber: "#fbbf24",
  red: "#fb7185",
  slate: "#94a3b8",
  grid: "rgba(148, 163, 184, 0.11)",
  axis: "#7e8ba3",
};

export const chartTooltipStyle = {
  backgroundColor: "rgba(8, 14, 27, 0.96)",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  borderRadius: "12px",
  boxShadow: "0 18px 40px -16px rgba(0,0,0,0.8)",
  color: "#e2e8f0",
  fontSize: "11px",
  padding: "9px 12px",
};

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Number(value).toFixed(digits)}%`;
}

export function formatMbps(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(2)} Gbps`;
  return `${Number(value).toFixed(value >= 100 ? 0 : 1)} Mbps`;
}

export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value)} ms`;
}

export function formatUptime(seconds: number | null | undefined): string {
  if (!seconds || seconds < 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

export function formatTime(value: string | null | undefined, withSeconds = false): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hour12: false,
  }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

/** Formats an exclusive range end as the last calendar day included in the range. */
export function formatInclusiveEnd(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(date.getTime() - 86_400_000),
  );
}

export function formatChartTime(value: string, range?: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const longRange = range === "7d" || range === "30d";
  return new Intl.DateTimeFormat("en-US", {
    month: longRange ? "short" : undefined,
    day: longRange ? "numeric" : undefined,
    hour: longRange ? undefined : "2-digit",
    minute: longRange ? undefined : "2-digit",
    hour12: false,
  }).format(date);
}

export function timeAgo(value: string | null | undefined): string {
  if (!value) return "never";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "unknown";
  const diff = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function statusMeta(status: ServerStatus | string | undefined) {
  switch (status) {
    case "healthy":
      return { label: "Healthy", className: "border-positive/25 bg-positive/10 text-positive", dot: "bg-positive" };
    case "warning":
      return { label: "Warning", className: "border-warning/25 bg-warning/10 text-warning", dot: "bg-warning" };
    case "critical":
      return { label: "Critical", className: "border-danger/25 bg-danger/10 text-danger", dot: "bg-danger" };
    case "offline":
      return { label: "Offline", className: "border-line/25 bg-line/10 text-muted", dot: "bg-muted" };
    case "active":
      return { label: "Active", className: "border-danger/25 bg-danger/10 text-danger", dot: "bg-danger" };
    case "acknowledged":
      return { label: "Acknowledged", className: "border-warning/25 bg-warning/10 text-warning", dot: "bg-warning" };
    case "resolved":
      return { label: "Resolved", className: "border-positive/25 bg-positive/10 text-positive", dot: "bg-positive" };
    default:
      return { label: "Unknown", className: "border-line/20 bg-line/5 text-muted", dot: "bg-muted" };
  }
}

export function severityMeta(severity: Severity | string | undefined) {
  return severity === "critical"
    ? { label: "Critical", className: "border-danger/25 bg-danger/10 text-danger" }
    : { label: "Warning", className: "border-warning/25 bg-warning/10 text-warning" };
}

export function healthLabel(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Healthy";
  if (score >= 50) return "Warning";
  return "Critical";
}

export function healthColor(score: number): string {
  if (score >= 90) return "#34d399";
  if (score >= 75) return "#22d3ee";
  if (score >= 50) return "#fbbf24";
  return "#fb7185";
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function initials(name: string | undefined): string {
  if (!name) return "CP";
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function rangeLabel(range: string): string {
  const labels: Record<string, string> = {
    "5m": "Last 5 minutes",
    "15m": "Last 15 minutes",
    "30m": "Last 30 minutes",
    "1h": "Last hour",
    "6h": "Last 6 hours",
    "12h": "Last 12 hours",
    "24h": "Last 24 hours",
    "7d": "Last 7 days",
    "30d": "Last 30 days",
    custom: "Custom range",
  };
  return labels[range] || range;
}

export function localDateInput(date = new Date()): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}
