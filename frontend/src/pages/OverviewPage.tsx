import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BellRing,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Radio,
  RefreshCw,
  Server,
  ShieldAlert,
  Timer,
  Wifi,
} from "lucide-react";
import { ChartCard, RadialGauge, Sparkline, TrendChart, type TrendSeries } from "../components/charts";
import {
  Button,
  EmptyState,
  ErrorState,
  ModeBadge,
  PageHeader,
  PageSkeleton,
  ProgressBar,
  SectionHeader,
  SegmentedControl,
  SeverityBadge,
  StatusBadge,
  Tag,
} from "../components/ui";
import { useSystem } from "../context/SystemContext";
import { useApi } from "../hooks/useApi";
import { useSocketEvent } from "../hooks/useSocketEvent";
import {
  CHART,
  cn,
  formatMoney,
  formatMbps,
  formatMs,
  formatPercent,
  healthColor,
  healthLabel,
  timeAgo,
} from "../lib/format";
import type { Overview, RecentEvent } from "../types";

const RANGES = [
  { value: "1h", label: "1H" },
  { value: "6h", label: "6H" },
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
];

const TREND_OPTIONS = [
  { value: "resources", label: "Resources" },
  { value: "network", label: "Network" },
  { value: "latency", label: "Latency" },
];

const RESOURCE_SERIES: TrendSeries[] = [
  { key: "cpu_percent", label: "CPU", color: CHART.accent, unit: "percent" },
  { key: "memory_percent", label: "Memory", color: CHART.violet, unit: "percent" },
  { key: "disk_percent", label: "Disk", color: CHART.amber, unit: "percent" },
];

const NETWORK_SERIES: TrendSeries[] = [
  { key: "network_in_mbps", label: "Ingress", color: CHART.blue, suffix: " Mbps" },
  { key: "network_out_mbps", label: "Egress", color: CHART.emerald, suffix: " Mbps" },
];

const LATENCY_SERIES: TrendSeries[] = [
  { key: "response_time_ms", label: "Response time", color: CHART.violet, suffix: " ms" },
];

function KpiCard({
  label,
  value,
  unit,
  icon,
  spark,
  color,
  hint,
  trend,
  footer,
}: {
  label: string;
  value: string;
  unit?: string;
  icon: ReactNode;
  spark?: number[];
  color?: string;
  hint?: string;
  trend?: number | null;
  footer?: React.ReactNode;
}) {
  const TrendIcon = (trend ?? 0) >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="card relative overflow-hidden p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted/80">{label}</p>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-[26px] font-semibold leading-none tracking-[-0.045em] text-ink">{value}</span>
            {unit && <span className="text-[11px] font-medium text-muted">{unit}</span>}
          </div>
        </div>
        <span
          className="grid h-8 w-8 place-items-center rounded-lg border border-line/15 bg-canvas/40"
          style={{ color: color || CHART.accent }}
        >
          {icon}
        </span>
      </div>

      {typeof trend === "number" && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px]">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 font-semibold",
              trend >= 0 ? "bg-positive/10 text-positive" : "bg-danger/10 text-danger",
            )}
          >
            <TrendIcon className="h-3 w-3" />
            {Math.abs(trend).toFixed(1)}%
          </span>
          <span className="text-muted/70">vs window start</span>
        </div>
      )}

      {hint && <p className="mt-2 text-[10px] leading-relaxed text-muted/75">{hint}</p>}
      {footer && <div className="mt-2.5">{footer}</div>}

      {spark && spark.length > 1 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 opacity-50">
          <Sparkline data={spark} color={color || CHART.accent} className="h-full" />
        </div>
      )}
    </div>
  );
}

function LivePulse({ event, connected }: { event: RecentEvent | null; connected: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-line/15 bg-panel/50 px-3 py-1.5 text-[10px]">
      <span className={cn("relative flex h-2 w-2", connected ? "text-positive" : "text-muted")}>
        {connected && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-60" />}
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", connected ? "bg-positive" : "bg-muted")} />
      </span>
      {event ? (
        <span className="text-muted">
          <span className="font-medium text-ink">{event.server_name}</span> · CPU {formatPercent(event.metrics.cpu_percent, 0)} ·{" "}
          {timeAgo(event.timestamp)}
        </span>
      ) : (
        <span className="text-muted">{connected ? "Waiting for the next telemetry frame…" : "Real-time stream offline"}</span>
      )}
    </div>
  );
}

export function OverviewPage() {
  const { mode, socketStatus } = useSystem();
  const navigate = useNavigate();
  const [range, setRange] = useState("24h");
  const [trendMode, setTrendMode] = useState("resources");
  const [liveEvent, setLiveEvent] = useState<RecentEvent | null>(null);
  const lastRefresh = useRef(0);
  const overviewApi = useApi<Overview>(`/dashboard/overview?range=${range}`, {
    refreshInterval: 45_000,
  });

  useSocketEvent<RecentEvent>("telemetry:update", (event) => {
    setLiveEvent(event);
    const now = Date.now();
    if (now - lastRefresh.current > 6_000) {
      lastRefresh.current = now;
      void overviewApi.refreshSilently();
    }
  });
  useSocketEvent("alert:new", () => void overviewApi.refreshSilently());

  const data = overviewApi.data;
  const metrics = data?.metrics;

  const series = useMemo(() => data?.series ?? [], [data?.series]);
  const sparkCpu = useMemo(() => series.map((point) => point.cpu_percent ?? 0), [series]);
  const sparkMemory = useMemo(() => series.map((point) => point.memory_percent ?? 0), [series]);
  const sparkNetwork = useMemo(() => series.map((point) => point.network_mbps ?? 0), [series]);
  const sparkLatency = useMemo(() => series.map((point) => point.response_time_ms ?? 0), [series]);

  const trendSeries = trendMode === "network" ? NETWORK_SERIES : trendMode === "latency" ? LATENCY_SERIES : RESOURCE_SERIES;

  const trendDelta = (values: number[]) => {
    if (values.length < 2) return null;
    const first = values[0] || 0;
    const last = values[values.length - 1] || 0;
    if (!first) return null;
    return ((last - first) / first) * 100;
  };

  if (overviewApi.loading && !data) return <PageSkeleton />;
  if (overviewApi.error && !data) return <ErrorState message={overviewApi.error} onRetry={() => void overviewApi.refresh()} />;
  if (!data || !metrics) return <ErrorState message="The overview payload was empty." onRetry={() => void overviewApi.refresh()} />;

  const activeRatio = metrics.total_servers ? (metrics.active_servers / metrics.total_servers) * 100 : 0;
  const averageHealth = data.servers.length
    ? data.servers.reduce((sum, server) => sum + server.health_score, 0) / data.servers.length
    : 0;
  const healthData = [
    { name: "Excellent", value: data.health_distribution.excellent, color: CHART.emerald },
    { name: "Healthy", value: data.health_distribution.healthy, color: CHART.accent },
    { name: "Warning", value: data.health_distribution.warning, color: CHART.amber },
    { name: "Critical", value: data.health_distribution.critical, color: CHART.red },
  ];
  const topServers = [...data.servers].sort((a, b) => a.health_score - b.health_score).slice(0, 5);

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        eyebrow="Command center"
        title="Fleet operations overview"
        description="A single operational picture across compute, storage and network targets — with an explicit boundary between demo and live telemetry."
        actions={
          <>
            <LivePulse event={liveEvent} connected={socketStatus === "connected"} />
            <SegmentedControl value={range} onChange={setRange} options={RANGES} size="sm" />
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className={cn("h-3.5 w-3.5", overviewApi.loading && "animate-spin")} />}
              onClick={() => void overviewApi.refresh()}
            >
              Refresh
            </Button>
          </>
        }
      />

      {mode === "demo" && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/20 bg-warning/[0.055] px-3.5 py-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-warning/90">
            <span className="font-semibold">Demo mode.</span> Every value on this page is simulated demonstration
            telemetry generated by the backend. No production system is being monitored.
          </p>
          <ModeBadge mode={mode} compact />
          <button
            type="button"
            onClick={() => navigate("/settings")}
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-warning transition hover:brightness-110"
          >
            Configure live monitoring <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          label="Active targets"
          value={`${metrics.active_servers}`}
          unit={`/ ${metrics.total_servers}`}
          icon={<Server className="h-4 w-4" />}
          color={CHART.accent}
          footer={
            <div>
              <ProgressBar value={activeRatio} color="linear-gradient(90deg, #22d3ee, #3b82f6)" />
              <p className="mt-1.5 text-[10px] text-muted">
                {metrics.offline_servers} offline · {formatPercent(activeRatio, 0)} reporting
              </p>
            </div>
          }
        />
        <KpiCard
          label="Average CPU"
          value={metrics.cpu_percent.toFixed(1)}
          unit="%"
          icon={<Cpu className="h-4 w-4" />}
          color={CHART.blue}
          spark={sparkCpu}
          trend={trendDelta(sparkCpu)}
        />
        <KpiCard
          label="Average memory"
          value={metrics.memory_percent.toFixed(1)}
          unit="%"
          icon={<MemoryStick className="h-4 w-4" />}
          color={CHART.violet}
          spark={sparkMemory}
          trend={trendDelta(sparkMemory)}
        />
        <KpiCard
          label="Open alerts"
          value={`${metrics.active_alerts}`}
          icon={<BellRing className="h-4 w-4" />}
          color={CHART.red}
          footer={
            <div className="flex items-center gap-3 text-[10px]">
              <span className="inline-flex items-center gap-1 text-danger">
                <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                {data.alert_summary.critical} critical
              </span>
              <span className="inline-flex items-center gap-1 text-warning">
                <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                {data.alert_summary.warning} warning
              </span>
            </div>
          }
        />
      </div>

      {/* Main chart + health */}
      <div className="grid gap-3 xl:grid-cols-12">
        <ChartCard
          className="xl:col-span-8"
          title="Fleet performance trend"
          description={`${range.toUpperCase()} window · aggregate across ${metrics.total_servers} ${metrics.total_servers === 1 ? "target" : "targets"}`}
          actions={
            <SegmentedControl value={trendMode} onChange={setTrendMode} options={TREND_OPTIONS} size="sm" />
          }
          footnote={data.notes.data_source + " · Bucketed averages, not raw sample values."}
        >
          <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 px-2">
            {trendMode === "resources" ? (
              <>
                <span className="flex items-center gap-1.5 text-[10px] text-muted">
                  <Cpu className="h-3 w-3" style={{ color: CHART.accent }} /> CPU{" "}
                  <span className="font-mono font-semibold text-ink">{formatPercent(metrics.cpu_percent)}</span>
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-muted">
                  <MemoryStick className="h-3 w-3" style={{ color: CHART.violet }} /> Memory{" "}
                  <span className="font-mono font-semibold text-ink">{formatPercent(metrics.memory_percent)}</span>
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-muted">
                  <HardDrive className="h-3 w-3" style={{ color: CHART.amber }} /> Disk{" "}
                  <span className="font-mono font-semibold text-ink">{formatPercent(metrics.disk_percent)}</span>
                </span>
              </>
            ) : trendMode === "network" ? (
              <>
                <span className="flex items-center gap-1.5 text-[10px] text-muted">
                  <Wifi className="h-3 w-3" style={{ color: CHART.blue }} /> Throughput{" "}
                  <span className="font-mono font-semibold text-ink">{formatMbps(metrics.network_mbps)}</span>
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-muted">
                  <Activity className="h-3 w-3" style={{ color: CHART.emerald }} /> Window samples{" "}
                  <span className="font-mono font-semibold text-ink">
                    {data.series.reduce((sum, point) => sum + (point.samples || 0), 0).toLocaleString()}
                  </span>
                </span>
              </>
            ) : (
              <>
                <span className="flex items-center gap-1.5 text-[10px] text-muted">
                  <Timer className="h-3 w-3" style={{ color: CHART.violet }} /> Avg response{" "}
                  <span className="font-mono font-semibold text-ink">{formatMs(metrics.response_time_ms)}</span>
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-muted">
                  <Gauge className="h-3 w-3" style={{ color: CHART.accent }} /> Uptime{" "}
                  <span className="font-mono font-semibold text-ink">{formatPercent(metrics.uptime_percent)}</span>
                </span>
              </>
            )}
          </div>
          <TrendChart
            data={data.series}
            series={trendSeries}
            range={range}
            height={288}
            yDomain={trendMode === "resources" ? [0, 100] : undefined}
          />
        </ChartCard>

        <div className="card flex flex-col p-4 xl:col-span-4">
          <SectionHeader
            title="Fleet health"
            description="Composite score across CPU, memory, disk, latency and reachability."
            actions={
              <Link to="/infrastructure" className="text-[10px] font-semibold text-accent hover:brightness-110">
                View all
              </Link>
            }
          />
          <div className="flex flex-col items-center gap-3 sm:flex-row xl:flex-col">
            <RadialGauge
              value={averageHealth}
              color={healthColor(averageHealth)}
              label="avg score"
              sublabel={healthLabel(averageHealth)}
              size={150}
            />
            <div className="w-full flex-1 space-y-2">
              {healthData.map((item) => (
                <div key={item.name}>
                  <div className="mb-1 flex items-center justify-between text-[10px]">
                    <span className="flex items-center gap-1.5 text-muted">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: item.color }} />
                      {item.name}
                    </span>
                    <span className="font-mono font-medium text-ink">{item.value}</span>
                  </div>
                  <ProgressBar
                    value={data.servers.length ? (item.value / data.servers.length) * 100 : 0}
                    color={item.color}
                    height="h-1"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line/10 pt-3">
            <div className="subtle-panel rounded-lg px-2.5 py-2">
              <p className="text-[9px] uppercase tracking-[0.12em] text-muted/60">Uptime</p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-ink">{formatPercent(metrics.uptime_percent)}</p>
            </div>
            <div className="subtle-panel rounded-lg px-2.5 py-2">
              <p className="text-[9px] uppercase tracking-[0.12em] text-muted/60">Anomalies 24h</p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-ink">{metrics.anomalies_24h}</p>
            </div>
            <div className="subtle-panel rounded-lg px-2.5 py-2">
              <p className="text-[9px] uppercase tracking-[0.12em] text-muted/60">Run-rate</p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-ink">{formatMoney(data.costs.monthly_estimated)}</p>
            </div>
            <div className="subtle-panel rounded-lg px-2.5 py-2">
              <p className="text-[9px] uppercase tracking-[0.12em] text-muted/60">Resolved</p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-ink">{data.alert_summary.resolved}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Alerts + servers */}
      <div className="grid gap-3 xl:grid-cols-12">
        <section className="card xl:col-span-5">
          <div className="flex items-start justify-between px-4 pb-2 pt-4">
            <div>
              <h2 className="text-[13px] font-semibold text-ink">Active incident queue</h2>
              <p className="mt-0.5 text-[10px] text-muted">Deduplicated threshold alerts, newest first.</p>
            </div>
            <Link
              to="/alerts"
              className="inline-flex items-center gap-1 rounded-lg border border-line/15 bg-panel/50 px-2 py-1 text-[10px] font-semibold text-muted transition hover:text-ink"
            >
              View queue <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="divide-y divide-line/8 px-2 pb-2">
            {data.recent_alerts.length === 0 ? (
              <EmptyState
                icon={<CheckCircle2 className="h-5 w-5 text-positive" />}
                title="No active alerts"
                description="Every monitored target is inside its configured thresholds."
                className="py-8"
              />
            ) : (
              data.recent_alerts.map((alert) => (
                <Link
                  key={alert.id}
                  to="/alerts"
                  className="group flex items-start gap-3 rounded-xl px-2 py-3 transition hover:bg-line/5"
                >
                  <span
                    className={cn(
                      "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border",
                      alert.severity === "critical"
                        ? "border-danger/25 bg-danger/10 text-danger"
                        : "border-warning/25 bg-warning/10 text-warning",
                    )}
                  >
                    {alert.severity === "critical" ? (
                      <ShieldAlert className="h-3.5 w-3.5" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[11px] font-semibold text-ink">{alert.title}</p>
                      <span className="shrink-0 text-[9px] text-muted/70">{timeAgo(alert.created_at)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted">{alert.description}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Tag>{alert.server_name}</Tag>
                      <SeverityBadge severity={alert.severity} />
                      {alert.status === "acknowledged" && (
                        <span className="chip border-accent/20 bg-accent/8 text-accent">Acknowledged</span>
                      )}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        <section className="card xl:col-span-7">
          <div className="flex items-start justify-between px-4 pb-2 pt-4">
            <div>
              <h2 className="text-[13px] font-semibold text-ink">Target health matrix</h2>
              <p className="mt-0.5 text-[10px] text-muted">Lowest health scores first. Click through for per-target history.</p>
            </div>
            <Link
              to="/infrastructure"
              className="inline-flex items-center gap-1 rounded-lg border border-line/15 bg-panel/50 px-2 py-1 text-[10px] font-semibold text-muted transition hover:text-ink"
            >
              Inventory <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="overflow-x-auto px-2 pb-2">
            <table className="table-base min-w-[600px]">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Status</th>
                  <th>Health</th>
                  <th>CPU</th>
                  <th>Memory</th>
                  <th>Network</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {topServers.map((server) => (
                  <tr key={server.id} className="cursor-pointer" onClick={() => navigate(`/infrastructure?server=${server.id}`)}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="grid h-7 w-7 place-items-center rounded-lg border border-line/15 bg-canvas/40 text-muted">
                          <Server className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-semibold text-ink">{server.name}</p>
                          <p className="truncate font-mono text-[9px] text-muted/70">{server.hostname}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={server.status} />
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-semibold" style={{ color: healthColor(server.health_score) }}>
                          {Math.round(server.health_score)}
                        </span>
                        <ProgressBar
                          value={server.health_score}
                          color={healthColor(server.health_score)}
                          height="h-1"
                          className="w-12"
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
                      {formatMbps(
                        ((server.latest_metrics?.network_in_bps ?? 0) + (server.latest_metrics?.network_out_bps ?? 0)) / 1e6,
                      )}
                    </td>
                    <td className="text-[10px] text-muted">{timeAgo(server.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Footer stats */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Network throughput", value: formatMbps(metrics.network_mbps), icon: Wifi, tone: CHART.blue },
          { label: "Average response", value: formatMs(metrics.response_time_ms), icon: Timer, tone: CHART.violet },
          { label: "Estimated run-rate", value: `${formatMoney(data.costs.monthly_estimated)}/mo`, icon: CircleDollarSign, tone: CHART.emerald },
          { label: "Anomalies (24h)", value: `${metrics.anomalies_24h}`, icon: BrainCircuit, tone: CHART.amber },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="card flex items-center gap-3 px-4 py-3">
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line/15 bg-canvas/40"
                style={{ color: stat.tone }}
              >
                <Icon className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted/70">{stat.label}</p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-ink">{stat.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-danger/20 bg-danger/8 text-danger">
            <Radio className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs font-semibold text-ink">Generate a daily operations brief</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-muted">
              Server availability, alert load, anomaly summary and cost exposure — exported as a branded PDF or CSV.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate("/reports")} icon={<ArrowRight className="h-3.5 w-3.5" />}>
            Open reports
          </Button>
          <Button variant="primary" size="sm" onClick={() => navigate("/anomalies")} icon={<BrainCircuit className="h-3.5 w-3.5" />}>
            Anomaly insights
          </Button>
        </div>
      </div>

      <p className="px-1 text-[9px] leading-relaxed text-muted/60">
        {data.notes.uptime} {data.notes.costs} Generated {timeAgo(data.generated_at)} · range {data.range.label}.
      </p>
    </div>
  );
}
