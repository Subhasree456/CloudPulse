import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Cpu,
  FlaskConical,
  Gauge,
  Info,
  Play,
  RefreshCw,
  ScanSearch,
  ShieldAlert,
  Sparkles,
  Timer,
} from "lucide-react";
import { BarsChart, ChartCard, RadialGauge } from "../components/charts";
import {
  Button,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  PageSkeleton,
  SegmentedControl,
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
import { CHART, cn, formatDateTime, formatPercent, timeAgo } from "../lib/format";
import type { AnomaliesResponse, DetectionRun } from "../types";

interface TimelineBucket {
  date: string;
  warning: number;
  critical: number;
  total: number;
}

const RANGE_OPTIONS = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
];

export function AnomaliesPage() {
  const { isAdmin } = useAuth();
  const { mode, settings } = useSystem();
  const toast = useToast();
  const [range, setRange] = useState("7d");
  const [severity, setSeverity] = useState("all");
  const [serverId, setServerId] = useState("all");
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<DetectionRun | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams({ range });
    if (severity !== "all") params.set("severity", severity);
    if (serverId !== "all") params.set("server_id", serverId);
    return params.toString();
  }, [range, severity, serverId]);

  const anomaliesApi = useApi<AnomaliesResponse>(`/anomalies?${query}`, { refreshInterval: 60_000 });
  const timelineApi = useApi<{ items: TimelineBucket[] }>("/anomalies/timeline", { refreshInterval: 120_000 });

  useSocketEvent("anomalies:updated", (run: DetectionRun) => {
    setRunResult(run);
    void anomaliesApi.refreshSilently();
    if (run.status === "completed" && run.new_anomalies > 0) {
      toast.info("Anomaly scan completed", `${run.new_anomalies} new anomaly record(s) stored.`);
    }
  });

  const runDetection = async () => {
    setRunning(true);
    try {
      const response = await apiRequest<{ run: DetectionRun; message: string }>("/anomalies/detect", { method: "POST" });
      setRunResult(response.run);
      if (response.run.status === "completed") toast.success("Detection completed", response.message);
      else toast.warning("Detection skipped", response.message);
      await anomaliesApi.refreshSilently();
    } catch (error) {
      toast.error("Detection failed", error instanceof Error ? error.message : undefined);
    } finally {
      setRunning(false);
    }
  };

  const data = anomaliesApi.data;
  const latestRun = runResult || data?.latest_run || null;
  const timeline = (timelineApi.data?.items || []).map((bucket) => ({
    ...bucket,
    label: bucket.date.slice(5),
  }));

  if (anomaliesApi.loading && !data) return <PageSkeleton />;
  if (anomaliesApi.error && !data) {
    return <ErrorState message={anomaliesApi.error} onRetry={() => void anomaliesApi.refresh()} />;
  }
  if (!data) return <ErrorState message="No anomaly payload returned." onRetry={() => void anomaliesApi.refresh()} />;

  const detectionHealth = latestRun?.status === "completed" ? 100 : latestRun?.status === "insufficient_data" ? 45 : 20;

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        eyebrow="Machine learning"
        title="Anomaly detection"
        description="An Isolation Forest model learns each target's normal resource envelope, then scores new points for multivariate outliers."
        actions={
          <>
            <SegmentedControl value={range} onChange={setRange} options={RANGE_OPTIONS} size="sm" />
            <Button
              variant="secondary"
              size="sm"
              icon={<Info className="h-3.5 w-3.5" />}
              onClick={() => setInfoOpen(true)}
            >
              How it works
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Play className="h-3.5 w-3.5" />}
              loading={running}
              disabled={!isAdmin || settings?.anomaly_detection_enabled === false}
              title={!isAdmin ? "Administrator role required" : undefined}
              onClick={() => void runDetection()}
            >
              Run detection
            </Button>
          </>
        }
      />

      {mode === "demo" && (
        <div className="flex items-start gap-2.5 rounded-xl border border-warning/20 bg-warning/[0.055] px-3.5 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-[11px] leading-relaxed text-warning/90">
            <span className="font-semibold">Training on simulated telemetry.</span> Anomalies are detected within
            generated demo data using the same scikit-learn pipeline that processes live samples.
          </p>
        </div>
      )}

      {settings?.anomaly_detection_enabled === false && (
        <div className="flex items-center gap-2 rounded-xl border border-line/20 bg-panel/50 px-3.5 py-2.5 text-[11px] text-muted">
          <Info className="h-4 w-4 text-accent" /> Anomaly detection is disabled in Settings. Manual and scheduled scans
          are skipped.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Anomalies in window", value: data.summary.total, icon: ScanSearch, tone: CHART.accent },
          { label: "Critical", value: data.summary.critical, icon: ShieldAlert, tone: CHART.red },
          { label: "Warning", value: data.summary.warning, icon: AlertTriangle, tone: CHART.amber },
          { label: "Affected targets", value: data.summary.servers, icon: FlaskConical, tone: CHART.violet },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="card flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted/70">{item.label}</p>
                <p className="mt-1 font-mono text-xl font-semibold text-ink">{item.value}</p>
              </div>
              <span
                className="grid h-8 w-8 place-items-center rounded-lg border border-line/15 bg-canvas/40"
                style={{ color: item.tone }}
              >
                <Icon className="h-4 w-4" />
              </span>
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 xl:grid-cols-12">
        <ChartCard
          className="xl:col-span-7"
          title="Anomaly volume by day"
          description="Seven-day rolling view of detected outliers, split by severity."
          actions={
            <span className="text-[9px] text-muted">
              {timeline.reduce((sum, bucket) => sum + bucket.total, 0)} events
            </span>
          }
          footnote="Volume alone is not risk: inspect the score, deviation and affected metric below."
        >
          {timeline.length ? (
            <BarsChart
              data={timeline}
              xKey="label"
              series={[
                { key: "warning", label: "Warning", color: CHART.amber },
                { key: "critical", label: "Critical", color: CHART.red },
              ]}
              height={244}
              stacked
            />
          ) : (
            <EmptyState
              icon={<BrainCircuit className="h-5 w-5" />}
              title="No anomaly history"
              description="Run a detection pass once at least 40 telemetry points exist per target."
              className="py-12"
            />
          )}
        </ChartCard>

        <section className="card flex flex-col xl:col-span-5">
          <div className="flex items-start justify-between px-4 pb-2 pt-4">
            <div>
              <h2 className="text-[13px] font-semibold text-ink">Latest detection run</h2>
              <p className="mt-0.5 text-[10px] text-muted">Model execution details from the scheduler or a manual scan.</p>
            </div>
            {latestRun && (
              <StatusBadge
                status={
                  latestRun.status === "completed"
                    ? "healthy"
                    : latestRun.status === "insufficient_data"
                      ? "warning"
                      : "offline"
                }
              />
            )}
          </div>

          {latestRun ? (
            <div className="flex flex-1 flex-col px-4 pb-4">
              <div className="flex flex-col items-center gap-3 sm:flex-row">
                <RadialGauge
                  value={detectionHealth}
                  size={124}
                  color={latestRun.status === "completed" ? CHART.emerald : CHART.amber}
                  label="scan state"
                  sublabel={latestRun.status.replace("_", " ")}
                />
                <div className="w-full flex-1 space-y-2">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="flex items-center gap-1.5 text-muted">
                      <Activity className="h-3 w-3" /> Analysed points
                    </span>
                    <span className="font-mono font-semibold text-ink">{latestRun.analyzed_points.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="flex items-center gap-1.5 text-muted">
                      <Cpu className="h-3 w-3" /> Analysed targets
                    </span>
                    <span className="font-mono font-semibold text-ink">{latestRun.analyzed_servers}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="flex items-center gap-1.5 text-muted">
                      <Sparkles className="h-3 w-3" /> New anomalies
                    </span>
                    <span className="font-mono font-semibold text-ink">{latestRun.new_anomalies}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="flex items-center gap-1.5 text-muted">
                      <Timer className="h-3 w-3" /> Trigger
                    </span>
                    <Tag>{latestRun.triggered_by}</Tag>
                  </div>
                </div>
              </div>

              <p className="mt-3 rounded-lg border border-line/12 bg-canvas/30 px-3 py-2 text-[10px] leading-relaxed text-muted">
                {latestRun.message}
              </p>
              {latestRun.skipped_servers?.length > 0 && (
                <p className="mt-1.5 text-[9px] leading-relaxed text-warning/85">
                  Skipped for insufficient history: {latestRun.skipped_servers.join(", ")}.
                </p>
              )}
              <p className="mt-2 text-[9px] text-muted/60">
                {formatDateTime(latestRun.run_at)} · {timeAgo(latestRun.run_at)}
              </p>
            </div>
          ) : (
            <EmptyState
              icon={<Gauge className="h-5 w-5" />}
              title="No scan has run yet"
              description="The scheduler triggers every 10 minutes by default; you can also run a manual pass."
              action={
                <Button variant="primary" size="sm" onClick={() => void runDetection()} loading={running} disabled={!isAdmin}>
                  Run first scan
                </Button>
              }
              className="flex-1 py-10"
            />
          )}
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line/10 px-4 py-3">
          <div>
            <h2 className="text-[13px] font-semibold text-ink">Detected anomalies</h2>
            <p className="mt-0.5 text-[10px] text-muted">Highest score first. Minimum {data.minimum_points} points per target required.</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <select
              value={serverId}
              onChange={(event) => setServerId(event.target.value)}
              className="h-8 max-w-[170px] rounded-lg border border-line/20 bg-canvas/40 px-2 text-[10px] text-muted outline-none transition hover:text-ink focus:border-accent/50"
              aria-label="Filter anomaly target"
            >
              <option value="all">All targets</option>
              {data.servers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name}
                </option>
              ))}
            </select>
            <select
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
              className="h-8 rounded-lg border border-line/20 bg-canvas/40 px-2 text-[10px] text-muted outline-none transition hover:text-ink focus:border-accent/50"
              aria-label="Filter anomaly severity"
            >
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
            </select>
          </div>
        </div>

        {data.items.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="h-5 w-5 text-positive" />}
            title="No anomalies in this window"
            description={data.message}
            className="py-14"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base min-w-[880px]">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Target</th>
                  <th>Metric</th>
                  <th>Observed</th>
                  <th>Expected</th>
                  <th>Score</th>
                  <th>Z-score</th>
                  <th>Detected</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((anomaly) => (
                  <tr key={anomaly.id}>
                    <td>
                      <SeverityBadge severity={anomaly.severity} />
                    </td>
                    <td>
                      <p className="text-[10px] font-semibold text-ink">{anomaly.server_name}</p>
                      <p className="text-[9px] text-muted/70">
                        {anomaly.data_source === "simulated" ? "simulated" : "live"} · {anomaly.detection_method}
                      </p>
                    </td>
                    <td>
                      <p className="text-[10px] text-ink">{anomaly.metric_label}</p>
                      <p className="text-[9px] uppercase tracking-[0.08em] text-muted/70">{anomaly.metric}</p>
                    </td>
                    <td className="font-mono text-[10px] font-semibold text-danger">
                      {anomaly.value.toFixed(1)}
                      {anomaly.unit}
                    </td>
                    <td className="font-mono text-[10px] text-ink">
                      {anomaly.expected.toFixed(1)}
                      {anomaly.unit}
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "font-mono text-[10px] font-semibold",
                            anomaly.anomaly_score >= 0.75 ? "text-danger" : "text-warning",
                          )}
                        >
                          {(anomaly.anomaly_score * 100).toFixed(0)}
                        </span>
                        <div className="h-1 w-12 overflow-hidden rounded-full bg-line/10">
                          <div
                            className={cn("h-full rounded-full", anomaly.anomaly_score >= 0.75 ? "bg-danger" : "bg-warning")}
                            style={{ width: `${Math.min(100, anomaly.anomaly_score * 100)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-[10px] text-ink">{anomaly.zscore.toFixed(2)}σ</td>
                    <td>
                      <p className="text-[10px] text-ink">{timeAgo(anomaly.timestamp)}</p>
                      <p className="text-[9px] text-muted/70">{formatDateTime(anomaly.timestamp)}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-3 xl:grid-cols-12">
        <section className="card xl:col-span-7">
          <div className="px-4 pb-2 pt-4">
            <h2 className="text-[13px] font-semibold text-ink">Detection run history</h2>
            <p className="mt-0.5 text-[10px] text-muted">Every scheduled and manual model execution is recorded.</p>
          </div>
          <div className="overflow-x-auto px-2 pb-2">
            <table className="table-base min-w-[560px]">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Targets</th>
                  <th>Points</th>
                  <th>Found</th>
                  <th>Triggered</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((run) => (
                  <tr key={run.id}>
                    <td className="font-mono text-[9px] text-muted">{run.id.slice(-10)}</td>
                    <td>
                      <span
                        className={cn(
                          "chip",
                          run.status === "completed"
                            ? "border-positive/20 bg-positive/8 text-positive"
                            : run.status === "insufficient_data"
                              ? "border-warning/20 bg-warning/8 text-warning"
                              : "border-line/20 bg-line/5 text-muted",
                        )}
                      >
                        {run.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="font-mono text-[10px] text-ink">{run.analyzed_servers}</td>
                    <td className="font-mono text-[10px] text-ink">{run.analyzed_points}</td>
                    <td className="font-mono text-[10px] text-ink">{run.new_anomalies}</td>
                    <td className="text-[10px] text-muted">{run.triggered_by}</td>
                    <td className="text-[10px] text-muted">{timeAgo(run.run_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card xl:col-span-5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-accent/20 bg-accent/8 text-accent">
              <BrainCircuit className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-[13px] font-semibold text-ink">Model card</h2>
              <p className="text-[10px] text-muted">Isolation Forest · scikit-learn</p>
            </div>
          </div>
          <div className="space-y-2">
            {[
              ["Features", "CPU, memory, disk, network ingress/egress, response time, load average"],
              ["Training", "Per-target model on the last 7 days of samples (minimum 40 points)"],
              ["Contamination", "Configured automatically from the observed score distribution"],
              ["Output", "Normalised anomaly score, z-score and the dominant contributing metric"],
              ["Limitations", "New targets and seasonal workloads may need more history before scoring is reliable"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-line/10 bg-canvas/25 px-3 py-2">
                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted/65">{label}</p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-ink/90">{value}</p>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            className="mt-3 inline-flex items-center gap-1 text-[10px] font-semibold text-accent transition hover:brightness-110"
          >
            Read the detection methodology <ArrowRight className="h-3 w-3" />
          </button>
        </section>
      </div>

      <Modal
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        title="How CloudPulse detects anomalies"
        description="An honest description of the implemented algorithm and its limits."
        size="lg"
        footer={<Button variant="secondary" onClick={() => setInfoOpen(false)}>Close</Button>}
      >
        <div className="space-y-3 text-[11px] leading-relaxed text-muted">
          <div className="rounded-xl border border-accent/15 bg-accent/5 p-3">
            <p className="font-semibold text-ink">1. Per-target feature windows</p>
            <p className="mt-1">
              Telemetry rows are grouped by server. Each sample becomes a feature vector of CPU, memory, disk, network
              throughput, response time and load average. At least {data.minimum_points} points are required, otherwise
              the target is skipped and reported as insufficient data.
            </p>
          </div>
          <div className="rounded-xl border border-line/12 bg-canvas/25 p-3">
            <p className="font-semibold text-ink">2. Isolation Forest scoring</p>
            <p className="mt-1">
              A scikit-learn IsolationForest is fitted per target. Isolation trees partition random features and split
              values; points isolated in fewer splits receive a higher anomaly score. Scores are normalised to 0–1, with
              0.5 used as the minimum reporting boundary.
            </p>
          </div>
          <div className="rounded-xl border border-line/12 bg-canvas/25 p-3">
            <p className="font-semibold text-ink">3. Explanation and persistence</p>
            <p className="mt-1">
              For each outlier, the pipeline computes the deviation from the feature median and records the dominant
              metric, a robust z-score and the expected value. Results are deduplicated by server, metric and timestamp,
              stored in the <span className="font-mono text-ink">anomalies</span> collection and emitted over Socket.IO.
            </p>
          </div>
          <div className="rounded-xl border border-warning/20 bg-warning/[0.055] p-3 text-warning/90">
            <p className="font-semibold">Important limitations</p>
            <p className="mt-1">
              An anomaly is not automatically an incident. Short histories, seasonal traffic and legitimate load tests
              can all appear anomalous. Correlate with alerts and operational context before acting. Demo mode trains on
              simulated values and is clearly labelled as such.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
