import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cpu,
  Filter,
  HardDrive,
  History,
  MemoryStick,
  RefreshCw,
  Server as ServerIcon,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Wifi,
  X,
} from "lucide-react";
import {
  Button,
  Drawer,
  EmptyState,
  ErrorState,
  KeyValue,
  PageHeader,
  PageSkeleton,
  SeverityBadge,
  StatusBadge,
  Tag,
} from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useSystem } from "../context/SystemContext";
import { useToast } from "../context/ToastContext";
import { useApi } from "../hooks/useApi";
import { useSocketEvent } from "../hooks/useSocketEvent";
import { apiRequest } from "../lib/api";
import { cn, formatDateTime, timeAgo, titleCase } from "../lib/format";
import type { Alert, AlertsResponse } from "../types";

const CATEGORY_ICONS: Record<string, typeof Cpu> = {
  cpu: Cpu,
  memory: MemoryStick,
  disk: HardDrive,
  network: Wifi,
  response_time: Timer,
  availability: Wifi,
};

const CATEGORIES = [
  { value: "all", label: "All categories" },
  { value: "cpu", label: "CPU" },
  { value: "memory", label: "Memory" },
  { value: "disk", label: "Disk" },
  { value: "network", label: "Network" },
  { value: "response_time", label: "Response time" },
  { value: "availability", label: "Availability" },
];

const STATUS_TABS = [
  { value: "active", label: "Active" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

export function AlertsPage() {
  const { isAdmin } = useAuth();
  const { mode } = useSystem();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("active");
  const [severity, setSeverity] = useState("all");
  const [category, setCategory] = useState("all");
  const [serverId, setServerId] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [resolveLoading, setResolveLoading] = useState(false);
  const [detailAlert, setDetailAlert] = useState<Alert | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: "12" });
    if (status !== "all") params.set("status", status);
    if (severity !== "all") params.set("severity", severity);
    if (category !== "all") params.set("category", category);
    if (serverId !== "all") params.set("server_id", serverId);
    return params.toString();
  }, [page, status, severity, category, serverId]);

  const alertsApi = useApi<AlertsResponse>(`/alerts?${query}`, { refreshInterval: 30_000 });
  const serversApi = useApi<{ items: { id: string; name: string }[] }>("/servers?limit=100");

  useSocketEvent("alert:new", (alert: Alert) => {
    void alertsApi.refreshSilently();
    if (alert.status === "active" && status === "active") toast.warning("New alert", alert.title);
  });
  useSocketEvent("alert:updated", () => void alertsApi.refreshSilently());

  const openAlert = (alert: Alert) => {
    setDetailAlert(alert);
    setSelectedId(alert.id);
    setResolveOpen(false);
    setReason("");
  };

  const refreshAfterAction = async () => {
    await alertsApi.refreshSilently();
    if (selectedId) {
      try {
        const detail = await apiRequest<{ alert: Alert }>(`/alerts/${selectedId}`);
        setDetailAlert(detail.alert);
      } catch {
        setDetailAlert(null);
      }
    }
  };

  const acknowledge = async (alert: Alert) => {
    setActionLoading("acknowledge");
    try {
      const response = await apiRequest<{ alert: Alert; message: string }>(`/alerts/${alert.id}/acknowledge`, {
        method: "POST",
      });
      toast.success("Alert acknowledged", response.message);
      setDetailAlert(response.alert);
      await refreshAfterAction();
    } catch (error) {
      toast.error("Acknowledge failed", error instanceof Error ? error.message : undefined);
    } finally {
      setActionLoading(null);
    }
  };

  const resolve = async () => {
    if (!detailAlert) return;
    setResolveLoading(true);
    try {
      const response = await apiRequest<{ alert: Alert; message: string }>(`/alerts/${detailAlert.id}/resolve`, {
        method: "POST",
        body: { reason: reason.trim() },
      });
      toast.success("Alert resolved", reason.trim() ? "Resolution note saved." : "No resolution note was provided.");
      setDetailAlert(response.alert);
      setResolveOpen(false);
      setReason("");
      await refreshAfterAction();
    } catch (error) {
      toast.error("Resolve failed", error instanceof Error ? error.message : undefined);
    } finally {
      setResolveLoading(false);
    }
  };

  const summary = alertsApi.data?.summary;
  const items = alertsApi.data?.items || [];
  const selected = detailAlert;

  if (alertsApi.loading && !alertsApi.data) return <PageSkeleton />;
  if (alertsApi.error && !alertsApi.data) {
    return <ErrorState message={alertsApi.error} onRetry={() => void alertsApi.refresh()} />;
  }

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        eyebrow="Incidents"
        title="Alert operations"
        description="Threshold alerts are deduplicated per target and category. Acknowledge to signal ownership; resolve to close the incident."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className={cn("h-3.5 w-3.5", alertsApi.loading && "animate-spin")} />}
              onClick={() => void alertsApi.refresh()}
            >
              Refresh
            </Button>
            {!isAdmin && (
              <span className="chip border-line/20 bg-line/5 text-muted">
                <ShieldCheck className="h-3 w-3" /> Read-only role
              </span>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { key: "active", label: "Active", value: summary?.active ?? 0, color: "danger", icon: BellRing },
          { key: "critical", label: "Critical", value: summary?.critical ?? 0, color: "danger", icon: ShieldAlert },
          { key: "warning", label: "Warnings", value: summary?.warning ?? 0, color: "warning", icon: AlertTriangle },
          { key: "resolved", label: "Resolved", value: summary?.resolved ?? 0, color: "positive", icon: CheckCircle2 },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.key} className="card flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted/70">{item.label}</p>
                <p className="mt-1 font-mono text-xl font-semibold text-ink">{item.value}</p>
              </div>
              <span
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-lg border",
                  item.color === "danger" && "border-danger/20 bg-danger/8 text-danger",
                  item.color === "warning" && "border-warning/20 bg-warning/8 text-warning",
                  item.color === "positive" && "border-positive/20 bg-positive/8 text-positive",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
            </div>
          );
        })}
      </div>

      {mode === "demo" && (
        <div className="flex items-start gap-2.5 rounded-xl border border-warning/20 bg-warning/[0.055] px-3.5 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-[11px] leading-relaxed text-warning/90">
            Demo mode alerts are generated from simulated threshold breaches. They exercise the same deduplication and
            lifecycle code as live alerts.
          </p>
        </div>
      )}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line/10 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-line/15 bg-canvas/35 p-0.5">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => {
                  setStatus(tab.value);
                  setPage(1);
                }}
                className={cn(
                  "h-7 rounded-[9px] px-2.5 text-[10px] font-semibold transition",
                  status === tab.value ? "bg-panel text-ink shadow-sm ring-1 ring-line/15" : "text-muted hover:text-ink",
                )}
              >
                {tab.label}
                {tab.value === "active" && summary?.active ? (
                  <span className="ml-1 rounded bg-danger/15 px-1 text-[8px] text-danger">{summary.active}</span>
                ) : null}
              </button>
            ))}
          </div>

          <select
            value={severity}
            onChange={(event) => {
              setSeverity(event.target.value);
              setPage(1);
            }}
            className="h-8 rounded-lg border border-line/20 bg-canvas/40 px-2 text-[10px] text-muted outline-none transition hover:text-ink focus:border-accent/50"
            aria-label="Filter severity"
          >
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
          </select>

          <select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setPage(1);
            }}
            className="h-8 rounded-lg border border-line/20 bg-canvas/40 px-2 text-[10px] text-muted outline-none transition hover:text-ink focus:border-accent/50"
            aria-label="Filter category"
          >
            {CATEGORIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>

          <select
            value={serverId}
            onChange={(event) => {
              setServerId(event.target.value);
              setPage(1);
            }}
            className="h-8 max-w-[180px] rounded-lg border border-line/20 bg-canvas/40 px-2 text-[10px] text-muted outline-none transition hover:text-ink focus:border-accent/50"
            aria-label="Filter target"
          >
            <option value="all">All targets</option>
            {(serversApi.data?.items || []).map((server) => (
              <option key={server.id} value={server.id}>
                {server.name}
              </option>
            ))}
          </select>

          <span className="ml-auto flex items-center gap-1.5 text-[10px] text-muted">
            <Filter className="h-3 w-3" />
            {alertsApi.data?.total ?? 0} matching
          </span>
        </div>

        {items.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="h-5 w-5 text-positive" />}
            title={status === "active" ? "No active alerts" : "No alerts match these filters"}
            description={
              status === "active"
                ? summary?.acknowledged
                  ? `${summary.acknowledged} acknowledged incident${
                      summary.acknowledged === 1 ? " is" : "s are"
                    } still open. All unacknowledged targets are inside their thresholds.`
                  : "All monitored targets are currently inside their configured thresholds."
                : "Try a different status, severity or target filter."
            }
            className="py-14"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base min-w-[860px]">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Alert</th>
                  <th>Target</th>
                  <th>Metric</th>
                  <th>Status</th>
                  <th>Raised</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((alert) => {
                  const Icon = CATEGORY_ICONS[alert.category] || AlertTriangle;
                  return (
                    <tr key={alert.id} className="cursor-pointer" onClick={() => openAlert(alert)}>
                      <td>
                        <SeverityBadge severity={alert.severity} />
                      </td>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <span
                            className={cn(
                              "grid h-7 w-7 shrink-0 place-items-center rounded-lg border",
                              alert.severity === "critical"
                                ? "border-danger/20 bg-danger/8 text-danger"
                                : "border-warning/20 bg-warning/8 text-warning",
                            )}
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[11px] font-semibold text-ink">{alert.title}</p>
                            <p className="line-clamp-2 max-w-md text-[9px] leading-relaxed text-muted">{alert.description}</p>
                          </div>
                        </div>
                      </td>
                      <td className="text-[10px] text-ink">{alert.server_name}</td>
                      <td>
                        <p className="font-mono text-[10px] text-ink">
                          {alert.metric_value === null || alert.metric_value === undefined
                            ? "—"
                            : `${alert.metric_value.toFixed(1)}${alert.metric_unit}`}
                        </p>
                        <p className="text-[9px] text-muted/70">
                          threshold {alert.threshold ?? "—"}
                          {alert.metric_unit}
                        </p>
                      </td>
                      <td>
                        <StatusBadge status={alert.status} />
                        <p className="mt-1 text-[9px] text-muted">
                          {alert.status === "resolved"
                            ? `by ${alert.resolved_by || "—"}`
                            : alert.status === "acknowledged"
                              ? `by ${alert.acknowledged_by || "—"}`
                              : "unowned"}
                        </p>
                      </td>
                      <td>
                        <p className="text-[10px] text-ink">{formatDateTime(alert.created_at)}</p>
                        <p className="text-[9px] text-muted/70">{timeAgo(alert.created_at)}</p>
                      </td>
                      <td className="text-right">
                        <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); openAlert(alert); }}>
                          Inspect
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {alertsApi.data && alertsApi.data.pages > 1 && (
          <div className="flex items-center justify-between border-t border-line/10 px-4 py-3">
            <p className="text-[10px] text-muted">
              Page {alertsApi.data.page} of {alertsApi.data.pages} · showing {items.length} of {alertsApi.data.total}
            </p>
            <div className="flex gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                icon={<ChevronLeft className="h-3.5 w-3.5" />}
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= alertsApi.data.pages}
                onClick={() => setPage((value) => value + 1)}
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </section>

      <Drawer
        open={Boolean(selected)}
        onClose={() => {
          setSelectedId(null);
          setDetailAlert(null);
          setResolveOpen(false);
        }}
        title={selected?.title || "Alert"}
        description={selected ? `${selected.server_name} · ${titleCase(selected.category)}` : undefined}
        footer={
          selected && isAdmin ? (
            selected.status === "resolved" ? (
              <span className="chip border-positive/20 bg-positive/8 text-positive">
                <CheckCircle2 className="h-3 w-3" /> Resolved
              </span>
            ) : (
              <>
                {selected.status === "active" && (
                  <Button
                    variant="secondary"
                    icon={<Check className="h-3.5 w-3.5" />}
                    loading={actionLoading === "acknowledge"}
                    onClick={() => void acknowledge(selected)}
                  >
                    Acknowledge
                  </Button>
                )}
                <Button
                  variant="primary"
                  icon={<ShieldCheck className="h-3.5 w-3.5" />}
                  onClick={() => setResolveOpen(true)}
                >
                  Resolve alert
                </Button>
              </>
            )
          ) : selected ? (
            <span className="text-[10px] text-muted">Viewers can inspect alerts but cannot change their lifecycle.</span>
          ) : null
        }
      >
        {selected && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={selected.severity} />
              <StatusBadge status={selected.status} />
              <Tag>{selected.category}</Tag>
              {selected.data_source === "simulated" && <Tag className="text-warning">demo</Tag>}
              <span className="ml-auto text-[10px] text-muted">{timeAgo(selected.created_at)}</span>
            </div>

            <div className="rounded-xl border border-danger/15 bg-danger/[0.045] px-3.5 py-3">
              <p className="text-[11px] leading-relaxed text-ink">{selected.description}</p>
              <p className="mt-2 text-[10px] leading-relaxed text-muted">
                <span className="font-semibold text-ink">Recommended action.</span> {selected.recommended_action}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="subtle-panel rounded-xl px-3 py-2.5">
                <p className="text-[9px] uppercase tracking-[0.12em] text-muted/70">Observed value</p>
                <p className="mt-1 font-mono text-lg font-semibold text-danger">
                  {selected.metric_value === null || selected.metric_value === undefined
                    ? "—"
                    : `${selected.metric_value.toFixed(1)}${selected.metric_unit}`}
                </p>
              </div>
              <div className="subtle-panel rounded-xl px-3 py-2.5">
                <p className="text-[9px] uppercase tracking-[0.12em] text-muted/70">Threshold</p>
                <p className="mt-1 font-mono text-lg font-semibold text-ink">
                  {selected.threshold ?? "—"}
                  {selected.metric_unit}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-line/12 bg-canvas/25 p-3">
              <p className="mb-1.5 text-[11px] font-semibold text-ink">Incident timeline</p>
              <div className="space-y-3">
                {[
                  { icon: BellRing, label: "Raised", value: formatDateTime(selected.created_at), tone: "text-danger" },
                  selected.acknowledged_at
                    ? {
                        icon: Check,
                        label: `Acknowledged by ${selected.acknowledged_by || "—"}`,
                        value: formatDateTime(selected.acknowledged_at),
                        tone: "text-warning",
                      }
                    : null,
                  selected.resolved_at
                    ? {
                        icon: CheckCircle2,
                        label: `Resolved by ${selected.resolved_by || "—"}`,
                        value: formatDateTime(selected.resolved_at),
                        tone: "text-positive",
                      }
                    : null,
                ]
                  .filter(Boolean)
                  .map((entry, index) => {
                    const item = entry!;
                    const Icon = item.icon;
                    return (
                      <div key={index} className="flex items-start gap-2.5">
                        <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line/15 bg-panel/50", item.tone)}>
                          <Icon className="h-3 w-3" />
                        </span>
                        <div>
                          <p className="text-[10px] font-medium text-ink">{item.label}</p>
                          <p className="text-[9px] text-muted">{item.value}</p>
                        </div>
                      </div>
                    );
                  })}
              </div>
              {selected.resolution_reason && (
                <div className="mt-3 rounded-lg border border-line/10 bg-panel/40 px-2.5 py-2">
                  <p className="text-[9px] uppercase tracking-[0.1em] text-muted/70">Resolution note</p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-ink">{selected.resolution_reason}</p>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-line/12 bg-canvas/25 p-3">
              <p className="mb-1.5 text-[11px] font-semibold text-ink">Alert metadata</p>
              <KeyValue label="Alert ID">
                <span className="font-mono text-[10px]">{selected.id}</span>
              </KeyValue>
              <KeyValue label="Target">
                <span className="flex items-center gap-1">
                  <ServerIcon className="h-3 w-3 text-muted" /> {selected.server_name}
                </span>
              </KeyValue>
              <KeyValue label="Source">{selected.data_source === "simulated" ? "Simulated demo" : "Live telemetry"}</KeyValue>
              <KeyValue label="Last updated">{formatDateTime(selected.updated_at)}</KeyValue>
            </div>

            {resolveOpen && (
              <div className="rounded-xl border border-accent/20 bg-accent/5 p-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                  <History className="h-3.5 w-3.5 text-accent" /> Resolution note
                </p>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={500}
                  placeholder="What was done to resolve this? Optional but useful for the audit trail."
                  className="textarea min-h-[76px] text-[11px]"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setResolveOpen(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" loading={resolveLoading} onClick={() => void resolve()}>
                    Confirm resolution
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>

    </div>
  );
}
