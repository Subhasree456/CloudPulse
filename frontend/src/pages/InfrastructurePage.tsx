import { useDeferredValue, useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Copy,
  Cpu,
  Database,
  Globe2,
  HardDrive,
  KeyRound,
  Laptop,
  Layers,
  MemoryStick,
  MoreHorizontal,
  Network,
  Plus,
  RefreshCw,
  Search,
  Server as ServerIcon,
  ShieldCheck,
  Trash2,
  Wifi,
} from "lucide-react";
import { ChartCard, TrendChart, type TrendSeries } from "../components/charts";
import {
  Button,
  ConfirmDialog,
  CopyButton,
  Drawer,
  EmptyState,
  ErrorState,
  FormField,
  IconButton,
  Input,
  KeyValue,
  Modal,
  PageHeader,
  PageSkeleton,
  ProgressBar,
  Select,
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
import {
  CHART,
  cn,
  formatMbps,
  formatMs,
  formatMoney,
  formatPercent,
  formatUptime,
  healthColor,
  healthLabel,
  timeAgo,
  titleCase,
} from "../lib/format";
import type {
  Alert,
  Anomaly,
  Server,
  ServerListResponse,
  TelemetryPoint,
} from "../types";

interface ServerDetail {
  server: Server;
  metrics: TelemetryPoint[];
  alerts: Alert[];
  anomalies: Anomaly[];
  alert_summary: { total: number; active: number; critical: number; warning: number };
  availability_24h: number;
  data_source: string;
}

interface AgentPayload {
  key: string;
  ingest_url: string;
  header: string;
  command: string;
  note: string;
}

const RESOURCE_TYPES = ["Virtual Machine", "Storage", "Application", "Database", "Container", "Network", "Other"];
const ENVIRONMENTS = ["production", "staging", "development", "testing"];

const DETAIL_SERIES: TrendSeries[] = [
  { key: "cpu_percent", label: "CPU", color: CHART.accent, unit: "percent" },
  { key: "memory_percent", label: "Memory", color: CHART.violet, unit: "percent" },
  { key: "disk_percent", label: "Disk", color: CHART.amber, unit: "percent" },
];

const RESOURCE_ICONS: Record<string, typeof ServerIcon> = {
  Storage: Database,
  Application: Layers,
  Database: Database,
  Container: Laptop,
  Network: Network,
};

function initialForm() {
  return {
    name: "",
    hostname: "",
    ip_address: "",
    os: "",
    resource_type: "Virtual Machine",
    environment: "production",
    provider: "Self-managed",
    region: "",
    description: "",
    tags: "",
    cost_per_hour: "0",
  };
}

export function InfrastructurePage() {
  const { isAdmin } = useAuth();
  const { mode } = useSystem();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const deferredSearch = useDeferredValue(search);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentPayload | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Server | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [rotateTarget, setRotateTarget] = useState<Server | null>(null);
  const [rotating, setRotating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(params.get("server"));

  const query = useMemo(() => {
    const searchParams = new URLSearchParams({ page: String(page), limit: "12" });
    if (deferredSearch.trim()) searchParams.set("q", deferredSearch.trim());
    if (status !== "all") searchParams.set("status", status);
    if (type !== "all") searchParams.set("type", type);
    return searchParams.toString();
  }, [page, deferredSearch, status, type]);

  const listApi = useApi<ServerListResponse>(`/servers?${query}`);
  const detailApi = useApi<ServerDetail>(detailId ? `/servers/${detailId}` : null);

  useSocketEvent("server:created", () => void listApi.refreshSilently());
  useSocketEvent("server:updated", () => {
    void listApi.refreshSilently();
    if (detailId) void detailApi.refreshSilently();
  });
  useSocketEvent("server:deleted", () => void listApi.refreshSilently());

  useEffect(() => {
    setPage(1);
  }, [deferredSearch, status, type]);

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (detailId) next.set("server", detailId);
    else next.delete("server");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailId]);

  const openDetail = (id: string) => setDetailId(id);
  const closeDetail = () => setDetailId(null);

  const submitServer = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const payload = {
        ...form,
        tags: form.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        cost_per_hour: Number(form.cost_per_hour) || 0,
      };
      const response = await apiRequest<{ server: Server; agent: AgentPayload; message: string }>("/servers", {
        method: "POST",
        body: payload,
      });
      setAgent(response.agent);
      setAddOpen(false);
      setForm(initialForm());
      toast.success("Monitoring target created", "Install the agent with the one-time key.");
      void listApi.refreshSilently();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to create the target.");
    } finally {
      setSaving(false);
    }
  };

  const runCheck = async (server: Server) => {
    setActionId(server.id);
    try {
      const response = await apiRequest<{ online: boolean; message: string }>(`/servers/${server.id}/check`, {
        method: "POST",
      });
      if (response.online) toast.success("Heartbeat verified", response.message);
      else toast.warning("Target offline", response.message);
      void listApi.refreshSilently();
      if (detailId === server.id) void detailApi.refreshSilently();
    } catch (error) {
      toast.error("Health check failed", error instanceof Error ? error.message : undefined);
    } finally {
      setActionId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest(`/servers/${deleteTarget.id}`, { method: "DELETE" });
      toast.success("Target removed", `${deleteTarget.name} and its history were deleted.`);
      setDeleteTarget(null);
      if (detailId === deleteTarget.id) setDetailId(null);
      void listApi.refreshSilently();
    } catch (error) {
      toast.error("Unable to remove target", error instanceof Error ? error.message : undefined);
    } finally {
      setDeleting(false);
    }
  };

  const confirmRotate = async () => {
    if (!rotateTarget) return;
    setRotating(true);
    try {
      const response = await apiRequest<{ agent: AgentPayload }>(`/servers/${rotateTarget.id}/rotate-key`, {
        method: "POST",
      });
      setAgent(response.agent);
      setRotateTarget(null);
      toast.success("Agent key rotated", "The previous key stopped working immediately.");
    } catch (error) {
      toast.error("Unable to rotate key", error instanceof Error ? error.message : undefined);
    } finally {
      setRotating(false);
    }
  };

  const statusCounts = listApi.data?.status_counts || {};
  const servers = listApi.data?.items || [];
  const detail = detailApi.data;

  if (listApi.loading && !listApi.data) return <PageSkeleton />;
  if (listApi.error && !listApi.data) return <ErrorState message={listApi.error} onRetry={() => void listApi.refresh()} />;

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        eyebrow="Inventory"
        title="Infrastructure targets"
        description="Register hosts and agents, inspect per-target telemetry and manage the complete lifecycle of every monitored resource."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className={cn("h-3.5 w-3.5", listApi.loading && "animate-spin")} />}
              onClick={() => void listApi.refresh()}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="h-3.5 w-3.5" />}
              disabled={!isAdmin || mode === "demo"}
              title={mode === "demo" ? "Switch to live mode to enroll real targets" : undefined}
              onClick={() => setAddOpen(true)}
            >
              Add target
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { key: "healthy", label: "Healthy", color: "positive", icon: ShieldCheck },
          { key: "warning", label: "Warning", color: "warning", icon: AlertTriangle },
          { key: "critical", label: "Critical", color: "danger", icon: Activity },
          { key: "offline", label: "Offline", color: "muted", icon: Wifi },
        ].map((item) => {
          const Icon = item.icon;
          const selected = status === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setStatus(selected ? "all" : item.key)}
              className={cn(
                "card flex items-center justify-between px-4 py-3 text-left transition hover:border-line/25",
                selected && "border-accent/35 ring-1 ring-accent/15",
              )}
            >
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted/70">{item.label}</p>
                <p className="mt-1 font-mono text-xl font-semibold text-ink">{statusCounts[item.key] ?? 0}</p>
              </div>
              <span
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-lg border",
                  item.color === "positive" && "border-positive/20 bg-positive/8 text-positive",
                  item.color === "warning" && "border-warning/20 bg-warning/8 text-warning",
                  item.color === "danger" && "border-danger/20 bg-danger/8 text-danger",
                  item.color === "muted" && "border-line/20 bg-line/5 text-muted",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
            </button>
          );
        })}
      </div>

      {mode === "demo" && (
        <div className="flex items-start gap-2.5 rounded-xl border border-warning/20 bg-warning/[0.055] px-3.5 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-[11px] leading-relaxed text-warning/90">
            Showing the simulated demo fleet. Live agent enrollment is disabled while demo mode is active — switch to
            live monitoring in Settings to register real hosts.
          </p>
        </div>
      )}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line/10 px-4 py-3">
          <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, hostname, IP, OS…"
              className="h-9 pl-9 text-[11px]"
              aria-label="Search targets"
            />
          </div>
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-9 w-auto min-w-[130px] text-[11px]"
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="healthy">Healthy</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
            <option value="offline">Offline</option>
          </Select>
          <Select
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="h-9 w-auto min-w-[150px] text-[11px]"
            aria-label="Filter by resource type"
          >
            <option value="all">All resource types</option>
            {RESOURCE_TYPES.map((value) => (
              <option key={value} value={value.toLowerCase()}>
                {value}
              </option>
            ))}
          </Select>
          <span className="ml-auto text-[10px] text-muted">
            {listApi.data?.total ?? 0} target{(listApi.data?.total ?? 0) === 1 ? "" : "s"}
          </span>
        </div>

        {servers.length === 0 ? (
          <EmptyState
            icon={<ServerIcon className="h-5 w-5" />}
            title="No targets match these filters"
            description="Adjust the search or filters, or register a new live monitoring target."
            action={
              isAdmin && mode === "live" ? (
                <Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAddOpen(true)}>
                  Add target
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base min-w-[940px]">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Type / environment</th>
                  <th>Status</th>
                  <th>Health</th>
                  <th>CPU</th>
                  <th>Memory</th>
                  <th>Disk</th>
                  <th>Network</th>
                  <th>Last seen</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((server) => {
                  const Icon = RESOURCE_ICONS[server.resource_type] || ServerIcon;
                  return (
                    <tr
                      key={server.id}
                      className="cursor-pointer"
                      onClick={() => openDetail(server.id)}
                    >
                      <td>
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-8 w-8 place-items-center rounded-lg border border-line/15 bg-canvas/40 text-muted">
                            <Icon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 truncate text-[11px] font-semibold text-ink">
                              {server.name}
                              {server.is_local && <Tag className="text-accent">this host</Tag>}
                              {server.data_source === "simulated" && <Tag className="text-warning">demo</Tag>}
                            </p>
                            <p className="truncate font-mono text-[9px] text-muted/70">
                              {server.hostname} · {server.ip_address || "no IP"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <p className="text-[10px] text-ink">{server.resource_type || "—"}</p>
                        <p className="mt-0.5 text-[9px] uppercase tracking-[0.08em] text-muted/70">
                          {server.environment || "production"} · {server.region || "—"}
                        </p>
                      </td>
                      <td>
                        <StatusBadge status={server.status} />
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <span
                            className="font-mono text-[11px] font-semibold"
                            style={{ color: healthColor(server.health_score) }}
                          >
                            {Math.round(server.health_score)}
                          </span>
                          <ProgressBar
                            value={server.health_score}
                            color={healthColor(server.health_score)}
                            className="w-12"
                            height="h-1"
                          />
                        </div>
                      </td>
                      <td className="font-mono text-[11px] text-ink">
                        {formatPercent(server.latest_metrics?.cpu_percent ?? null, 0)}
                      </td>
                      <td className="font-mono text-[11px] text-ink">
                        {formatPercent(server.latest_metrics?.memory_percent ?? null, 0)}
                      </td>
                      <td className="font-mono text-[11px] text-ink">
                        {formatPercent(server.latest_metrics?.disk_percent ?? null, 0)}
                      </td>
                      <td className="font-mono text-[11px] text-ink">
                        {formatMbps(
                          ((server.latest_metrics?.network_in_bps ?? 0) +
                            (server.latest_metrics?.network_out_bps ?? 0)) /
                            1e6,
                        )}
                      </td>
                      <td className="text-[10px] text-muted">{timeAgo(server.last_seen)}</td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <IconButton
                            label={`Check ${server.name}`}
                            className="h-7 w-7"
                            onClick={() => void runCheck(server)}
                            disabled={actionId === server.id}
                          >
                            <Activity className={cn("h-3.5 w-3.5", actionId === server.id && "animate-pulse")} />
                          </IconButton>
                          <IconButton label={`Open ${server.name}`} className="h-7 w-7" onClick={() => openDetail(server.id)}>
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {listApi.data && listApi.data.pages > 1 && (
          <div className="flex items-center justify-between border-t border-line/10 px-4 py-3">
            <p className="text-[10px] text-muted">
              Page {listApi.data.page} of {listApi.data.pages} · {listApi.data.total} targets
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
                disabled={page >= listApi.data.pages}
                onClick={() => setPage((value) => value + 1)}
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Detail drawer */}
      <Drawer
        open={Boolean(detailId)}
        onClose={closeDetail}
        title={detail?.server.name || "Loading target…"}
        description={detail?.server.hostname}
        width="max-w-2xl"
        footer={
          detail && (
            <>
              <Button
                variant="secondary"
                icon={<Activity className="h-3.5 w-3.5" />}
                onClick={() => void runCheck(detail.server)}
                loading={actionId === detail.server.id}
              >
                Health check
              </Button>
              {isAdmin && detail.server.data_source === "live" && (
                <Button
                  variant="secondary"
                  icon={<KeyRound className="h-3.5 w-3.5" />}
                  onClick={() => setRotateTarget(detail.server)}
                >
                  Rotate key
                </Button>
              )}
              {isAdmin && (
                <Button
                  variant="danger"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  disabled={detail.server.is_local}
                  title={detail.server.is_local ? "The local collector target cannot be removed" : undefined}
                  onClick={() => setDeleteTarget(detail.server)}
                >
                  Remove
                </Button>
              )}
            </>
          )
        }
      >
        {detailApi.loading && !detail ? (
          <div className="space-y-3">
            <div className="skeleton h-24 rounded-xl" />
            <div className="skeleton h-52 rounded-xl" />
            <div className="skeleton h-40 rounded-xl" />
          </div>
        ) : detailApi.error ? (
          <ErrorState message={detailApi.error} onRetry={() => void detailApi.refresh()} />
        ) : detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.server.status} />
              <Tag>{detail.server.resource_type}</Tag>
              <Tag>{detail.server.environment}</Tag>
              <Tag>{detail.server.provider || "Self-managed"}</Tag>
              {detail.server.data_source === "simulated" && (
                <span className="chip border-warning/25 bg-warning/10 text-warning">Simulated</span>
              )}
              <span className="ml-auto text-[10px] text-muted">24h availability {formatPercent(detail.availability_24h)}</span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: "CPU", value: formatPercent(detail.server.latest_metrics?.cpu_percent ?? null), icon: Cpu },
                { label: "Memory", value: formatPercent(detail.server.latest_metrics?.memory_percent ?? null), icon: MemoryStick },
                { label: "Disk", value: formatPercent(detail.server.latest_metrics?.disk_percent ?? null), icon: HardDrive },
                { label: "Response", value: formatMs(detail.server.latest_metrics?.response_time_ms ?? null), icon: Activity },
              ].map((metric) => {
                const Icon = metric.icon;
                return (
                  <div key={metric.label} className="subtle-panel rounded-xl px-3 py-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-[9px] uppercase tracking-[0.12em] text-muted/70">{metric.label}</p>
                      <Icon className="h-3 w-3 text-muted/50" />
                    </div>
                    <p className="mt-1 font-mono text-sm font-semibold text-ink">{metric.value}</p>
                  </div>
                );
              })}
            </div>

            <div className="rounded-xl border border-line/12 bg-canvas/25 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-semibold text-ink">Recent telemetry</p>
                <span className="text-[9px] text-muted">{detail.metrics.length} samples retained</span>
              </div>
              {detail.metrics.length > 1 ? (
                <TrendChart data={detail.metrics} series={DETAIL_SERIES} height={190} range="1h" yDomain={[0, 100]} />
              ) : (
                <p className="py-8 text-center text-[10px] text-muted">
                  Not enough samples yet. Once the agent reports, trends appear here.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-line/12 bg-canvas/25 p-3">
              <p className="mb-1.5 text-[11px] font-semibold text-ink">Target details</p>
              <KeyValue label="Hostname">{detail.server.hostname}</KeyValue>
              <KeyValue label="IP address">{detail.server.ip_address || "—"}</KeyValue>
              <KeyValue label="Operating system">{detail.server.os || "—"}</KeyValue>
              <KeyValue label="Region">{detail.server.region || "—"}</KeyValue>
              <KeyValue label="Health score">
                <span style={{ color: healthColor(detail.server.health_score) }}>
                  {Math.round(detail.server.health_score)} · {healthLabel(detail.server.health_score)}
                </span>
              </KeyValue>
              <KeyValue label="Uptime">{formatUptime(detail.server.latest_metrics?.uptime_seconds)}</KeyValue>
              <KeyValue label="Network">
                {formatMbps(
                  ((detail.server.latest_metrics?.network_in_bps ?? 0) +
                    (detail.server.latest_metrics?.network_out_bps ?? 0)) /
                    1e6,
                )}
              </KeyValue>
              <KeyValue label="Cost rate">{formatMoney(detail.server.cost_per_hour)}/hour</KeyValue>
              <KeyValue label="Last heartbeat">{timeAgo(detail.server.last_seen)}</KeyValue>
              {detail.server.tags.length > 0 && (
                <KeyValue label="Tags">
                  <span className="flex flex-wrap justify-end gap-1">
                    {detail.server.tags.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </span>
                </KeyValue>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-line/12 bg-canvas/25 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                  <AlertTriangle className="h-3.5 w-3.5 text-warning" /> Recent alerts
                  <span className="ml-auto text-[9px] font-normal text-muted">{detail.alert_summary.active} active</span>
                </p>
                {detail.alerts.length === 0 ? (
                  <p className="py-4 text-center text-[10px] text-muted">No alerts recorded for this target.</p>
                ) : (
                  <div className="space-y-2">
                    {detail.alerts.slice(0, 4).map((alert) => (
                      <div key={alert.id} className="rounded-lg border border-line/10 bg-panel/40 px-2.5 py-2">
                        <div className="flex items-center justify-between gap-1">
                          <p className="truncate text-[10px] font-medium text-ink">{alert.title}</p>
                          <SeverityBadge severity={alert.severity} />
                        </div>
                        <p className="mt-0.5 text-[9px] text-muted">
                          {titleCase(alert.status)} · {timeAgo(alert.created_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-line/12 bg-canvas/25 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                  <CircleDot className="h-3.5 w-3.5 text-accent" /> Anomalies
                  <span className="ml-auto text-[9px] font-normal text-muted">{detail.anomalies.length} recent</span>
                </p>
                {detail.anomalies.length === 0 ? (
                  <p className="py-4 text-center text-[10px] text-muted">No anomalies detected for this target.</p>
                ) : (
                  <div className="space-y-2">
                    {detail.anomalies.slice(0, 4).map((anomaly) => (
                      <div key={anomaly.id} className="rounded-lg border border-line/10 bg-panel/40 px-2.5 py-2">
                        <div className="flex items-center justify-between gap-1">
                          <p className="truncate text-[10px] font-medium text-ink">{anomaly.metric_label}</p>
                          <SeverityBadge severity={anomaly.severity} />
                        </div>
                        <p className="mt-0.5 text-[9px] text-muted">
                          {anomaly.value.toFixed(1)}
                          {anomaly.unit} · score {(anomaly.anomaly_score * 100).toFixed(0)} · {timeAgo(anomaly.timestamp)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>

      {/* Add target modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Register a live monitoring target"
        description="Create a host record and a one-time agent key. The key is only displayed once."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="add-server-form" loading={saving} icon={<Plus className="h-3.5 w-3.5" />}>
              Create target
            </Button>
          </>
        }
      >
        <form id="add-server-form" className="grid gap-3 sm:grid-cols-2" onSubmit={submitServer}>
          <FormField label="Target name">
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="prod-api-09"
              required
            />
          </FormField>
          <FormField label="Hostname">
            <Input
              value={form.hostname}
              onChange={(event) => setForm({ ...form, hostname: event.target.value })}
              placeholder="prod-api-09.internal"
              required
            />
          </FormField>
          <FormField label="IP address">
            <Input
              value={form.ip_address}
              onChange={(event) => setForm({ ...form, ip_address: event.target.value })}
              placeholder="10.0.4.19"
            />
          </FormField>
          <FormField label="Operating system">
            <Input
              value={form.os}
              onChange={(event) => setForm({ ...form, os: event.target.value })}
              placeholder="Ubuntu 24.04 LTS"
            />
          </FormField>
          <FormField label="Resource type">
            <Select
              value={form.resource_type}
              onChange={(event) => setForm({ ...form, resource_type: event.target.value })}
            >
              {RESOURCE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Environment">
            <Select
              value={form.environment}
              onChange={(event) => setForm({ ...form, environment: event.target.value })}
            >
              {ENVIRONMENTS.map((value) => (
                <option key={value} value={value}>
                  {titleCase(value)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Provider">
            <Input
              value={form.provider}
              onChange={(event) => setForm({ ...form, provider: event.target.value })}
              placeholder="AWS · Azure · GCP · self-managed"
            />
          </FormField>
          <FormField label="Region / zone">
            <Input
              value={form.region}
              onChange={(event) => setForm({ ...form, region: event.target.value })}
              placeholder="eu-central-1a"
            />
          </FormField>
          <FormField label="Cost per hour (USD)" hint="Used only for run-rate estimates, not billing.">
            <Input
              type="number"
              min="0"
              step="0.001"
              value={form.cost_per_hour}
              onChange={(event) => setForm({ ...form, cost_per_hour: event.target.value })}
            />
          </FormField>
          <FormField label="Tags (comma separated)">
            <Input
              value={form.tags}
              onChange={(event) => setForm({ ...form, tags: event.target.value })}
              placeholder="web, critical, eu-west"
            />
          </FormField>
          <FormField label="Description" className="sm:col-span-2">
            <Input
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="Customer-facing API fleet member"
            />
          </FormField>
          {formError && (
            <div className="sm:col-span-2 rounded-xl border border-danger/25 bg-danger/8 px-3 py-2 text-[11px] text-danger">
              {formError}
            </div>
          )}
          <div className="sm:col-span-2 rounded-xl border border-accent/15 bg-accent/5 px-3 py-2.5 text-[10px] leading-relaxed text-muted">
            After creating the target, run{" "}
            <span className="font-mono text-ink">python agent/cloudpulse_agent.py --url &lt;api&gt; --key &lt;key&gt;</span>{" "}
            on the host. Requires Python 3 and psutil. CloudPulse stores only a hash of the agent key.
          </div>
        </form>
      </Modal>

      {/* One-time key modal */}
      <Modal
        open={Boolean(agent)}
        onClose={() => setAgent(null)}
        title="Agent enrollment key"
        description="Copy this key now — it cannot be shown again. Treat it like a credential."
        footer={<Button variant="primary" onClick={() => setAgent(null)}>I have stored the key</Button>}
      >
        {agent && (
          <div className="space-y-3">
            <div className="rounded-xl border border-warning/25 bg-warning/8 px-3 py-2 text-[10px] leading-relaxed text-warning">
              <strong>One-time secret.</strong> Rotating the key later will immediately invalidate this value.
            </div>
            <div>
              <p className="label">Agent key</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-line/15 bg-canvas/50 px-3 py-2 font-mono text-[11px] text-accent">
                  {agent.key}
                </code>
                <CopyButton value={agent.key} label="Copy key" />
              </div>
            </div>
            <div>
              <p className="label">Agent command</p>
              <div className="rounded-lg border border-line/15 bg-canvas/50 p-3">
                <pre className="whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed text-ink">{agent.command}</pre>
              </div>
              <div className="mt-2 flex justify-end">
                <CopyButton value={agent.command} label="Copy command" />
              </div>
            </div>
            <div className="rounded-xl border border-line/12 bg-canvas/25 p-3 text-[10px] leading-relaxed text-muted">
              <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-ink">
                <Globe2 className="h-3.5 w-3.5 text-accent" /> Ingest endpoint
              </p>
              <code className="font-mono text-[10px] text-ink">{agent.ingest_url}</code>
              <p className="mt-1.5">
                Header <span className="font-mono text-ink">{agent.header}</span>. {agent.note}
              </p>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
        title={`Remove ${deleteTarget?.name || "target"}?`}
        description="This permanently deletes the target, its telemetry, alerts and anomaly history. The action cannot be undone."
        confirmLabel="Delete target"
        loading={deleting}
      />

      <ConfirmDialog
        open={Boolean(rotateTarget)}
        onClose={() => setRotateTarget(null)}
        onConfirm={() => void confirmRotate()}
        title="Rotate agent key?"
        description="The current agent key stops working immediately. Any running agent must be restarted with the new key."
        confirmLabel="Rotate key"
        loading={rotating}
        tone="primary"
      />
    </div>
  );
}
