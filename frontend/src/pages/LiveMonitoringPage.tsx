import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Server as ServerIcon,
  Timer,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { ChartCard, Sparkline, TrendChart, type TrendSeries } from "../components/charts";
import {
  Button,
  EmptyState,
  ErrorState,
  ModeBadge,
  PageHeader,
  PageSkeleton,
  ProgressBar,
  SegmentedControl,
  Select,
  StatusBadge,
  Tag,
} from "../components/ui";
import { useSystem } from "../context/SystemContext";
import { useApi } from "../hooks/useApi";
import { useSocketEvent } from "../hooks/useSocketEvent";
import {
  CHART,
  cn,
  formatMbps,
  formatMs,
  formatPercent,
  formatUptime,
  healthColor,
  timeAgo,
} from "../lib/format";
import type { RecentEvent, Server, ServerListResponse, TelemetryPoint } from "../types";

const RANGE_OPTIONS = [
  { value: "15m", label: "15M" },
  { value: "1h", label: "1H" },
  { value: "6h", label: "6H" },
];

const LIVE_SERIES: TrendSeries[] = [
  { key: "cpu_percent", label: "CPU", color: CHART.accent, unit: "percent" },
  { key: "memory_percent", label: "Memory", color: CHART.violet, unit: "percent" },
];

const HISTORY_SERIES: TrendSeries[] = [
  { key: "cpu_percent", label: "CPU", color: CHART.accent, unit: "percent" },
  { key: "memory_percent", label: "Memory", color: CHART.violet, unit: "percent" },
  { key: "disk_percent", label: "Disk", color: CHART.amber, unit: "percent" },
];

interface HistoryResponse {
  items: TelemetryPoint[];
  total: number;
  data_source: string;
}

export function LiveMonitoringPage() {
  const { mode, settings, socketStatus } = useSystem();
  const [paused, setPaused] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [range, setRange] = useState("15m");
  const [liveEvents, setLiveEvents] = useState<RecentEvent[]>([]);
  const [eventCount, setEventCount] = useState(0);
  const [now, setNow] = useState(Date.now());
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const serversApi = useApi<ServerListResponse>("/servers?limit=100", { refreshInterval: 60_000 });
  const historyApi = useApi<HistoryResponse>("/telemetry/history?range=30m&limit=60", {
    refreshInterval: 60_000,
  });
  const detailApi = useApi<HistoryResponse>(selectedId ? `/servers/${selectedId}/metrics?range=${range}&limit=180` : null, {
    refreshInterval: 20_000,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedId && serversApi.data?.items.length) {
      setSelectedId(serversApi.data.items[0].id);
    }
  }, [selectedId, serversApi.data?.items]);

  useSocketEvent<RecentEvent>("telemetry:update", (event) => {
    if (pausedRef.current) return;
    setEventCount((count) => count + 1);
    setLiveEvents((current) => {
      if (current.some((item) => item.timestamp === event.timestamp && item.server_id === event.server_id)) return current;
      return [event, ...current].slice(0, 80);
    });
  });

  const servers = serversApi.data?.items || [];
  const latestByServer = useMemo(() => {
    const map = new Map<string, RecentEvent>();
    for (const event of liveEvents) {
      if (!map.has(event.server_id)) map.set(event.server_id, event);
    }
    return map;
  }, [liveEvents]);

  const historyByServer = useMemo(() => {
    const map = new Map<string, TelemetryPoint[]>();
    for (const row of historyApi.data?.items || []) {
      const list = map.get(row.server_id) || [];
      if (list.length < 16) list.unshift(row);
      map.set(row.server_id, list);
    }
    return map;
  }, [historyApi.data?.items]);

  const liveServerState = (server: Server) => {
    const live = latestByServer.get(server.id);
    if (live) {
      return {
        cpu: live.metrics.cpu_percent,
        memory: live.metrics.memory_percent,
        disk: live.metrics.disk_percent,
        network: live.metrics.network_mbps,
        response: live.metrics.response_time_ms,
        health: live.health_score,
        status: live.status,
        timestamp: live.timestamp,
      };
    }
    const metrics = server.latest_metrics;
    return {
      cpu: metrics?.cpu_percent ?? null,
      memory: metrics?.memory_percent ?? null,
      disk: metrics?.disk_percent ?? null,
      network: metrics ? (metrics.network_in_bps + metrics.network_out_bps) / 1e6 : null,
      response: metrics?.response_time_ms ?? null,
      health: server.health_score,
      status: server.status,
      timestamp: metrics?.timestamp || server.last_seen,
    };
  };

  const aggregate = useMemo(() => {
    const active = servers.filter((server) => server.status !== "offline");
    const values = active
      .map((server) => liveServerState(server))
      .filter((item) => item.cpu !== null) as { cpu: number; memory: number; network: number | null; response: number | null }[];
    const avg = (numbers: (number | null)[]) => {
      const valid = numbers.filter((value): value is number => typeof value === "number");
      return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
    };
    return {
      cpu: avg(values.map((item) => item.cpu)),
      memory: avg(values.map((item) => item.memory)),
      network: avg(values.map((item) => item.network)),
      response: avg(values.map((item) => item.response)),
      streaming: active.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers, latestByServer]);

  const selected = servers.find((server) => server.id === selectedId);
  const selectedEvents = liveEvents.filter((event) => event.server_id === selectedId).slice(0, 40);

  if (serversApi.loading && !serversApi.data) return <PageSkeleton />;
  if (serversApi.error && !serversApi.data) {
    return <ErrorState message={serversApi.error} onRetry={() => void serversApi.refresh()} />;
  }

  const streamHealthy = socketStatus === "connected" && !paused;

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        eyebrow="Real-time"
        title="Live monitoring stream"
        description="Frames arrive over Socket.IO as each agent reports. Pause the stream to inspect values without losing the connection."
        actions={
          <>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                streamHealthy
                  ? "border-positive/25 bg-positive/8 text-positive"
                  : paused
                    ? "border-warning/25 bg-warning/8 text-warning"
                    : "border-line/20 bg-line/5 text-muted",
              )}
            >
              {streamHealthy ? (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-positive" />
                </span>
              ) : paused ? (
                <Pause className="h-3 w-3" />
              ) : (
                <WifiOff className="h-3 w-3" />
              )}
              {paused ? "Paused" : streamHealthy ? "Streaming" : "Disconnected"}
            </span>
            <Button
              variant="secondary"
              size="sm"
              icon={paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              onClick={() => setPaused((value) => !value)}
            >
              {paused ? "Resume" : "Pause"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className={cn("h-3.5 w-3.5", serversApi.loading && "animate-spin")} />}
              onClick={() => {
                void serversApi.refresh();
                void historyApi.refresh();
                if (selectedId) void detailApi.refresh();
              }}
            >
              Refresh
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line/12 bg-panel/40 px-3.5 py-2.5 text-[10px] text-muted">
        <span className="flex items-center gap-1.5">
          <Radio className="h-3.5 w-3.5 text-accent" /> Collection interval{" "}
          <span className="font-mono font-semibold text-ink">{settings?.monitoring_interval_seconds ?? 5}s</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-accent" /> Frames received{" "}
          <span className="font-mono font-semibold text-ink">{eventCount.toLocaleString()}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <ServerIcon className="h-3.5 w-3.5 text-accent" /> Streaming targets{" "}
          <span className="font-mono font-semibold text-ink">{aggregate.streaming}</span>
        </span>
        <span className="ml-auto flex items-center gap-2">
          <ModeBadge mode={mode} compact />
          {mode === "demo" && (
            <span className="inline-flex items-center gap-1 text-warning">
              <AlertTriangle className="h-3 w-3" /> All frames are simulated
            </span>
          )}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Streaming CPU", value: formatPercent(aggregate.cpu), icon: Cpu, color: CHART.accent },
          { label: "Streaming memory", value: formatPercent(aggregate.memory), icon: MemoryStick, color: CHART.violet },
          { label: "Network average", value: formatMbps(aggregate.network), icon: Wifi, color: CHART.blue },
          { label: "Response average", value: formatMs(aggregate.response), icon: Timer, color: CHART.emerald },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="card flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted/70">{item.label}</p>
                <p className="mt-1 font-mono text-xl font-semibold text-ink">{item.value}</p>
              </div>
              <span
                className="grid h-9 w-9 place-items-center rounded-xl border border-line/15 bg-canvas/40"
                style={{ color: item.color }}
              >
                <Icon className="h-4 w-4" />
              </span>
            </div>
          );
        })}
      </div>

      {/* server cards */}
      {servers.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<ServerIcon className="h-5 w-5" />}
            title="No monitoring targets"
            description="Register a target in Infrastructure or switch back to demo mode to explore the pipeline."
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {servers.map((server) => {
            const state = liveServerState(server);
            const spark =
              server.data_source === "simulated"
                ? (historyByServer.get(server.id) || []).map((point) => point.cpu_percent)
                : liveEvents
                    .filter((event) => event.server_id === server.id)
                    .slice(0, 20)
                    .reverse()
                    .map((event) => event.metrics.cpu_percent);
            const isSelected = selectedId === server.id;
            return (
              <button
                key={server.id}
                type="button"
                onClick={() => setSelectedId(server.id)}
                className={cn(
                  "card relative overflow-hidden p-3.5 text-left transition hover:border-line/30",
                  isSelected && "border-accent/35 ring-1 ring-accent/15",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate text-[11px] font-semibold text-ink">
                      {server.name}
                      {server.data_source === "simulated" && <Tag className="text-warning">demo</Tag>}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[9px] text-muted/70">{server.hostname}</p>
                  </div>
                  <StatusBadge status={state.status} />
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    { label: "CPU", value: formatPercent(state.cpu, 0) },
                    { label: "MEM", value: formatPercent(state.memory, 0) },
                    { label: "NET", value: formatMbps(state.network) },
                  ].map((metric) => (
                    <div key={metric.label}>
                      <p className="text-[8px] font-semibold uppercase tracking-[0.1em] text-muted/60">{metric.label}</p>
                      <p className="mt-0.5 font-mono text-[11px] font-semibold text-ink">{metric.value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-2.5 space-y-1.5">
                  <ProgressBar
                    value={state.cpu ?? 0}
                    color={state.cpu && state.cpu > 85 ? CHART.red : CHART.accent}
                    height="h-1"
                  />
                  <ProgressBar value={state.memory ?? 0} color={CHART.violet} height="h-1" />
                </div>

                <div className="mt-2 h-8 opacity-60">
                  <Sparkline data={spark} color={healthColor(state.health)} height={32} />
                </div>

                <div className="mt-2 flex items-center justify-between border-t border-line/8 pt-2 text-[9px] text-muted">
                  <span className="flex items-center gap-1">
                    <span
                      className={cn("h-1.5 w-1.5 rounded-full", streamHealthy ? "bg-positive" : "bg-muted")}
                    />
                    {state.timestamp ? `${Math.max(0, Math.round((now - new Date(state.timestamp).getTime()) / 1000))}s ago` : "no data"}
                  </span>
                  <span className="font-mono" style={{ color: healthColor(state.health) }}>
                    health {Math.round(state.health)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-12">
        <ChartCard
          className="xl:col-span-8"
          title={selected ? `${selected.name} · live signal` : "Live signal"}
          description="Bucketed per-target history. New frames appear automatically every few seconds."
          actions={
            <div className="flex items-center gap-1.5">
              <Select
                value={selectedId ?? ""}
                onChange={(event) => setSelectedId(event.target.value)}
                className="h-7 w-auto min-w-[150px] text-[10px]"
                aria-label="Select monitored target"
              >
                {servers.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.name}
                  </option>
                ))}
              </Select>
              <SegmentedControl value={range} onChange={setRange} options={RANGE_OPTIONS} size="sm" />
            </div>
          }
        >
          {detailApi.data?.items && detailApi.data.items.length > 1 ? (
            <TrendChart
              data={detailApi.data.items}
              series={HISTORY_SERIES}
              range={range}
              height={270}
              yDomain={[0, 100]}
            />
          ) : (
            <div className="flex h-[270px] items-center justify-center text-[11px] text-muted">
              {detailApi.loading ? "Loading history…" : "Waiting for enough telemetry points."}
            </div>
          )}
        </ChartCard>

        <section className="card flex flex-col xl:col-span-4">
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <div>
              <h2 className="text-[13px] font-semibold text-ink">Frame feed</h2>
              <p className="mt-0.5 text-[10px] text-muted">Most recent frames, newest first.</p>
            </div>
            <span className="chip border-line/15 bg-line/5 text-muted">{liveEvents.length}</span>
          </div>
          <div className="max-h-[360px] flex-1 overflow-y-auto px-2 pb-2">
            {liveEvents.length === 0 ? (
              <EmptyState
                icon={<Radio className="h-5 w-5" />}
                title={paused ? "Stream paused" : "Waiting for frames"}
                description={
                  paused
                    ? "Resume the stream to accumulate new telemetry frames."
                    : "The backend emits frames on the configured collection interval."
                }
                className="py-12"
              />
            ) : (
              <div className="divide-y divide-line/8">
                {liveEvents.slice(0, 24).map((event) => (
                  <div key={`${event.server_id}-${event.timestamp}`} className="flex items-start gap-2 px-2 py-2">
                    <span
                      className={cn(
                        "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                        event.status === "critical"
                          ? "bg-danger"
                          : event.status === "warning"
                            ? "bg-warning"
                            : "bg-positive",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[10px] font-semibold text-ink">{event.server_name}</p>
                        <span className="shrink-0 font-mono text-[9px] text-muted/60">
                          {new Date(event.timestamp).toLocaleTimeString("en-GB", { hour12: false })}
                        </span>
                      </div>
                      <p className="mt-0.5 font-mono text-[9px] text-muted">
                        CPU {event.metrics.cpu_percent.toFixed(0)}% · MEM {event.metrics.memory_percent.toFixed(0)}% · NET{" "}
                        {formatMbps(event.metrics.network_mbps)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="border-t border-line/10 px-4 py-2 text-[9px] text-muted/60">
            {paused ? "Frames are discarded while paused." : `Stream ${socketStatus}.`}
          </div>
        </section>
      </div>

      {selected && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Health score", value: `${Math.round(selected.health_score)} / 100`, icon: Gauge },
            { label: "Disk usage", value: formatPercent(selected.latest_metrics?.disk_percent ?? null), icon: HardDrive },
            { label: "Uptime", value: formatUptime(selected.latest_metrics?.uptime_seconds), icon: Activity },
            { label: "Last heartbeat", value: timeAgo(selected.last_seen), icon: Wifi },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="card flex items-center gap-3 px-4 py-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg border border-line/15 bg-canvas/40 text-accent">
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-[9px] uppercase tracking-[0.12em] text-muted/70">{item.label}</p>
                  <p className="mt-0.5 font-mono text-[13px] font-semibold text-ink">{item.value}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="px-1 text-[9px] leading-relaxed text-muted/60">
        {mode === "demo"
          ? "The backend demo generator produces frames on the collection interval; these are simulated values."
          : "Live frames originate from the local psutil collector or remote agents authenticated with an X-Agent-Key."}{" "}
        Charts aggregate incoming samples into time buckets and never interpolate missing data.
      </p>
    </div>
  );
}
