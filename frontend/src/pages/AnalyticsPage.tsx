import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CalendarRange,
  CircleDollarSign,
  Cpu,
  Download,
  Gauge,
  HardDrive,
  MemoryStick,
  Network,
  Server as ServerIcon,
  TrendingUp,
  Wifi,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  BarsChart,
  ChartCard,
  DonutChart,
  TrendChart,
  type TrendSeries,
} from "../components/charts";
import {
  Button,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  PageHeader,
  PageSkeleton,
  ProgressBar,
  SegmentedControl,
  Tag,
} from "../components/ui";
import { useSystem } from "../context/SystemContext";
import { useToast } from "../context/ToastContext";
import { useApi } from "../hooks/useApi";
import { downloadFile } from "../lib/api";
import {
  CHART,
  cn,
  formatDate,
  formatMbps,
  formatMoney,
  formatMs,
  formatPercent,
  healthColor,
  localDateInput,
  timeAgo,
} from "../lib/format";
import type { AnalyticsData } from "../types";

const RANGE_OPTIONS = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
];

const COMPARE_SERIES: TrendSeries[] = [
  { key: "cpu_percent", label: "CPU", color: CHART.accent, unit: "percent" },
  { key: "memory_percent", label: "Memory", color: CHART.violet, unit: "percent" },
  { key: "disk_percent", label: "Disk", color: CHART.amber, unit: "percent" },
];

const PRICE_COLORS = [CHART.accent, CHART.blue, CHART.violet, CHART.emerald, CHART.amber, CHART.red];

export function AnalyticsPage() {
  const { mode } = useSystem();
  const toast = useToast();
  const navigate = useNavigate();
  const [preset, setPreset] = useState("7d");
  const [from, setFrom] = useState(localDateInput(new Date(Date.now() - 6 * 86400_000)));
  const [to, setTo] = useState(localDateInput());
  const [custom, setCustom] = useState(false);
  const [metric, setMetric] = useState<"cpu_percent" | "memory_percent" | "network_mbps" | "response_time_ms">(
    "cpu_percent",
  );
  const [downloading, setDownloading] = useState(false);

  const path = custom
    ? from && to && from <= to
      ? `/analytics?from=${from}&to=${to}`
      : null
    : `/analytics?range=${preset}`;

  const analyticsApi = useApi<AnalyticsData>(path);
  const data = analyticsApi.data;

  const focusedSeries = useMemo(() => {
    if (!data) return [];
    switch (metric) {
      case "memory_percent":
        return [{ key: "memory_percent", label: "Memory", color: CHART.violet, unit: "percent" as const }];
      case "network_mbps":
        return [{ key: "network_mbps", label: "Throughput", color: CHART.blue, suffix: " Mbps" }];
      case "response_time_ms":
        return [{ key: "response_time_ms", label: "Response", color: CHART.amber, suffix: " ms" }];
      default:
        return [{ key: "cpu_percent", label: "CPU", color: CHART.accent, unit: "percent" as const }];
    }
  }, [data, metric]);

  const dailyData = useMemo(
    () =>
      (data?.daily || []).map((point) => ({
        ...point,
        shortDate: point.date.slice(5),
      })),
    [data?.daily],
  );

  const costData = useMemo(
    () =>
      (data?.costs.by_type || []).map((item, index) => ({
        name: item.type,
        value: item.monthly,
        color: PRICE_COLORS[index % PRICE_COLORS.length],
      })),
    [data?.costs.by_type],
  );

  const exportCsv = async () => {
    setDownloading(true);
    try {
      const query = custom ? `from=${from}&to=${to}` : `range=${preset}`;
      await downloadFile(`/reports/export?dataset=telemetry&${query}`, "cloudpulse-telemetry.csv");
      toast.success("CSV export ready", "The telemetry dataset has been downloaded.");
    } catch (error) {
      toast.error("Export failed", error instanceof Error ? error.message : undefined);
    } finally {
      setDownloading(false);
    }
  };

  if (analyticsApi.loading && !data) return <PageSkeleton />;
  if (analyticsApi.error && !data) {
    return <ErrorState message={analyticsApi.error} onRetry={() => void analyticsApi.refresh()} />;
  }
  if (!data) return <ErrorState message="No analytics data returned." onRetry={() => void analyticsApi.refresh()} />;

  const metricOptions = [
    { value: "cpu_percent" as const, label: "CPU" },
    { value: "memory_percent" as const, label: "Memory" },
    { value: "network_mbps" as const, label: "Network" },
    { value: "response_time_ms" as const, label: "Latency" },
  ];

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        eyebrow="Intelligence"
        title="Capacity & cost analytics"
        description="Compare resource consumption across the fleet, understand availability and estimate run-rate exposure over time."
        actions={
          <>
            <SegmentedControl
              value={custom ? "custom" : preset}
              onChange={(value) => {
                if (value === "custom") setCustom(true);
                else {
                  setCustom(false);
                  setPreset(value);
                }
              }}
              options={[...RANGE_OPTIONS, { value: "custom", label: "Custom" }]}
              size="sm"
            />
            <Button
              variant="secondary"
              size="sm"
              icon={<Download className="h-3.5 w-3.5" />}
              onClick={() => void exportCsv()}
              loading={downloading}
            >
              Export CSV
            </Button>
          </>
        }
      />

      {custom && (
        <div className="card flex flex-wrap items-end gap-3 p-3.5">
          <FormField label="From" className="w-full sm:w-44">
            <Input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
          </FormField>
          <FormField label="To" className="w-full sm:w-44">
            <Input type="date" value={to} min={from} max={localDateInput()} onChange={(event) => setTo(event.target.value)} />
          </FormField>
          <div className="flex items-center gap-2 pb-0.5">
            <Button
              variant="primary"
              size="sm"
              icon={<CalendarRange className="h-3.5 w-3.5" />}
              onClick={() => void analyticsApi.refresh()}
              disabled={!from || !to || from > to}
            >
              Apply range
            </Button>
            {from > to && <span className="text-[10px] text-danger">From must be before To.</span>}
          </div>
          <p className="ml-auto pb-0.5 text-[10px] text-muted">
            {data.range.label === "custom" ? `${formatDate(data.range.start)} → ${formatDate(data.range.end)}` : ""}
          </p>
        </div>
      )}

      {mode === "demo" && (
        <div className="flex items-start gap-2.5 rounded-xl border border-warning/20 bg-warning/[0.055] px-3.5 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-[11px] leading-relaxed text-warning/90">
            <span className="font-semibold">Simulated analytics.</span> Aggregations are computed from generated demo
            telemetry. Cost figures are estimates from configured hourly rates, not cloud invoices.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          {
            label: "Average CPU",
            value: formatPercent(data.totals.avg_cpu),
            detail: `${data.totals.samples.toLocaleString()} samples`,
            icon: Cpu,
            color: CHART.accent,
          },
          {
            label: "Average memory",
            value: formatPercent(data.totals.avg_memory),
            detail: `${data.totals.servers} targets in window`,
            icon: MemoryStick,
            color: CHART.violet,
          },
          {
            label: "Fleet availability",
            value: formatPercent(data.totals.avg_availability),
            detail: `${data.totals.alerts} alerts in window`,
            icon: Gauge,
            color: CHART.emerald,
          },
          {
            label: "Estimated run-rate",
            value: `${formatMoney(data.costs.monthly_estimated)}`,
            detail: "per month, configured rates",
            icon: CircleDollarSign,
            color: CHART.amber,
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="card px-4 py-3.5">
              <div className="flex items-start justify-between">
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted/70">{item.label}</p>
                <span
                  className="grid h-7 w-7 place-items-center rounded-lg border border-line/15 bg-canvas/40"
                  style={{ color: item.color }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
              </div>
              <p className="mt-1.5 font-mono text-[22px] font-semibold leading-none tracking-[-0.03em] text-ink">
                {item.value}
              </p>
              <p className="mt-1.5 text-[10px] text-muted">{item.detail}</p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 xl:grid-cols-12">
        <ChartCard
          className="xl:col-span-8"
          title="Resource trend"
          description="Aggregate bucket averages across the selected window."
          actions={<SegmentedControl value={metric} onChange={setMetric} options={metricOptions} size="sm" />}
          footnote={data.notes.data_source + " · Bucket width adapts to the selected range."}
        >
          <div className="mb-2 flex flex-wrap items-center gap-3 px-2">
            <Tag className="border-accent/20 text-accent">{data.range.label}</Tag>
            <span className="text-[10px] text-muted">
              {formatDate(data.range.start)} → {formatDate(data.range.end)}
            </span>
            <span className="ml-auto text-[10px] text-muted">
              Avg response <span className="font-mono text-ink">{formatMs(data.series.at(-1)?.response_time_ms ?? null)}</span>
            </span>
          </div>
          {data.series.length > 1 ? (
            <TrendChart
              data={data.series}
              series={focusedSeries}
              range={data.range.label}
              height={296}
              yDomain={metric === "cpu_percent" || metric === "memory_percent" ? [0, 100] : undefined}
            />
          ) : (
            <EmptyState title="Not enough telemetry" description="Collect a few more samples to render this trend." />
          )}
        </ChartCard>

        <ChartCard
          className="xl:col-span-4"
          title="Cost distribution"
          description={data.costs.note}
          footnote={data.notes.costs}
        >
          {costData.length ? (
            <>
              <DonutChart
                data={costData}
                height={200}
                centerLabel="per month"
                centerValue={formatMoney(data.costs.monthly_estimated)}
              />
              <div className="mt-2 space-y-1.5 px-3 pb-2">
                {costData.map((item) => (
                  <div key={item.name} className="flex items-center justify-between text-[10px]">
                    <span className="flex items-center gap-1.5 text-muted">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: item.color }} />
                      {item.name}
                    </span>
                    <span className="font-mono text-ink">{formatMoney(item.value)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyState title="No cost data" description="Set an hourly rate on a target to estimate run-rate." />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-3 xl:grid-cols-12">
        <ChartCard
          className="xl:col-span-7"
          title="Daily resource profile"
          description="Average CPU and memory by calendar day in the window."
        >
          {dailyData.length > 1 ? (
            <BarsChart
              data={dailyData}
              xKey="shortDate"
              series={[
                { key: "cpu_percent", label: "CPU", color: CHART.accent },
                { key: "memory_percent", label: "Memory", color: CHART.violet },
              ]}
              height={252}
            />
          ) : (
            <EmptyState title="Daily history pending" description="Only one day of samples is available in this window." />
          )}
        </ChartCard>

        <ChartCard
          className="xl:col-span-5"
          title="Availability by target"
          description="Heartbeat-derived availability within the window."
          actions={
            <button
              type="button"
              onClick={() => navigate("/infrastructure")}
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-accent"
            >
              Inventory <ArrowRight className="h-3 w-3" />
            </button>
          }
        >
          <div className="max-h-[286px] space-y-2.5 overflow-y-auto px-2 py-1">
            {data.availability.map((item) => (
              <div key={item.id}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted">
                    <span className={cn("h-1.5 w-1.5 rounded-full", item.availability >= 99.5 ? "bg-positive" : item.availability >= 95 ? "bg-warning" : "bg-danger")} />
                    <span className="truncate text-ink">{item.name}</span>
                  </span>
                  <span className="font-mono text-[10px] font-medium text-ink">{formatPercent(item.availability)}</span>
                </div>
                <ProgressBar
                  value={item.availability}
                  color={item.availability >= 99.5 ? CHART.emerald : item.availability >= 95 ? CHART.amber : CHART.red}
                  height="h-1"
                />
              </div>
            ))}
            {!data.availability.length && <EmptyState title="No targets" description="Register a target to measure availability." />}
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-3 xl:grid-cols-12">
        <section className="card xl:col-span-7">
          <div className="flex items-start justify-between px-4 pb-2 pt-4">
            <div>
              <h2 className="text-[13px] font-semibold text-ink">Fleet comparison</h2>
              <p className="mt-0.5 text-[10px] text-muted">Per-target averages across the selected window.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate("/infrastructure")} icon={<ArrowRight className="h-3.5 w-3.5" />}>
              Details
            </Button>
          </div>
          <div className="overflow-x-auto px-2 pb-2">
            <table className="table-base min-w-[640px]">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Health</th>
                  <th>CPU</th>
                  <th>Memory</th>
                  <th>Disk</th>
                  <th>Network</th>
                  <th>Availability</th>
                </tr>
              </thead>
              <tbody>
                {data.comparisons.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="grid h-6 w-6 place-items-center rounded-md border border-line/15 bg-canvas/40 text-muted">
                          <ServerIcon className="h-3 w-3" />
                        </span>
                        <div>
                          <p className="text-[10px] font-medium text-ink">{item.name}</p>
                          <p className="text-[9px] text-muted/70">{item.resource_type}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="font-mono text-[10px] font-semibold" style={{ color: healthColor(item.health_score) }}>
                        {Math.round(item.health_score)}
                      </span>
                    </td>
                    <td className="font-mono text-[10px] text-ink">{formatPercent(item.cpu_percent)}</td>
                    <td className="font-mono text-[10px] text-ink">{formatPercent(item.memory_percent)}</td>
                    <td className="font-mono text-[10px] text-ink">{formatPercent(item.disk_percent)}</td>
                    <td className="font-mono text-[10px] text-ink">{formatMbps(item.network_mbps)}</td>
                    <td className="font-mono text-[10px] text-ink">{formatPercent(item.availability)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <ChartCard
          className="xl:col-span-5"
          title="Top consumers"
          description="Targets with the highest average CPU in this window."
          actions={<TrendingUp className="h-3.5 w-3.5 text-accent" />}
        >
          <div className="space-y-2.5 px-2 py-1">
            {data.top_consumers.slice(0, 6).map((item, index) => (
              <div key={item.id} className="rounded-lg border border-line/10 bg-canvas/25 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-[10px]">
                    <span className="grid h-4 w-4 shrink-0 place-items-center rounded bg-line/10 font-mono text-[8px] text-muted">
                      {index + 1}
                    </span>
                    <span className="truncate font-medium text-ink">{item.name}</span>
                  </span>
                  <span className="font-mono text-[10px] text-accent">{formatPercent(item.cpu_percent)}</span>
                </div>
                <ProgressBar value={item.cpu_percent} color={CHART.accent} height="h-1" className="mt-1.5" />
                <div className="mt-1 flex items-center justify-between text-[9px] text-muted/70">
                  <span className="flex items-center gap-1">
                    <MemoryStick className="h-2.5 w-2.5" /> {formatPercent(item.memory_percent)} mem
                  </span>
                  <span className="flex items-center gap-1">
                    <Network className="h-2.5 w-2.5" /> {formatMbps(item.network_mbps)}
                  </span>
                  <span className="flex items-center gap-1">
                    <HardDrive className="h-2.5 w-2.5" /> {formatPercent(item.disk_percent)} disk
                  </span>
                </div>
              </div>
            ))}
            {!data.top_consumers.length && <EmptyState title="No consumption data" description="Samples will populate this list." />}
          </div>
        </ChartCard>
      </div>

      <div className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p className="text-[10px] leading-relaxed text-muted">
            {data.totals.anomalies} anomalies were detected in this window. Availability is derived from heartbeat
            recency, not synthetic uptime probes. Generated {timeAgo(data.generated_at)}.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" size="sm" icon={<Activity className="h-3.5 w-3.5" />} onClick={() => navigate("/monitoring")}>
            Live stream
          </Button>
          <Button variant="primary" size="sm" icon={<ArrowRight className="h-3.5 w-3.5" />} onClick={() => navigate("/reports")}>
            Create report
          </Button>
        </div>
      </div>
    </div>
  );
}
