import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  FileDown,
  FileText,
  Gauge,
  Layers,
  RefreshCw,
  Server as ServerIcon,
  ShieldCheck,
  Table2,
} from "lucide-react";
import { ChartCard, Sparkline, TrendChart, type TrendSeries } from "../components/charts";
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  PageSkeleton,
  ProgressBar,
  SegmentedControl,
  SeverityBadge,
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
  formatDateTime,
  formatInclusiveEnd,
  formatMoney,
  formatPercent,
  healthColor,
  localDateInput,
  timeAgo,
} from "../lib/format";
import type { ReportRecord, ReportSummary } from "../types";

const REPORT_SERIES: TrendSeries[] = [
  { key: "cpu_percent", label: "CPU", color: CHART.accent, unit: "percent" },
  { key: "memory_percent", label: "Memory", color: CHART.violet, unit: "percent" },
];

export function ReportsPage() {
  const { mode } = useSystem();
  const toast = useToast();
  const [type, setType] = useState<"daily" | "weekly">("daily");
  const [date, setDate] = useState(localDateInput());
  const [downloading, setDownloading] = useState<"pdf" | "csv" | null>(null);

  const previewApi = useApi<ReportSummary>(`/reports/summary?type=${type}&date=${date}`, { refreshInterval: 120_000 });
  const historyApi = useApi<{ items: ReportRecord[]; total: number }>("/reports", { refreshInterval: 60_000 });

  const report = previewApi.data;

  const downloadPdf = async () => {
    setDownloading("pdf");
    try {
      await downloadFile(`/reports/pdf?type=${type}&date=${date}`, `cloudpulse-${type}.pdf`);
      toast.success("PDF report generated", "The branded report has been downloaded and recorded.");
      void historyApi.refreshSilently();
    } catch (error) {
      toast.error("PDF generation failed", error instanceof Error ? error.message : undefined);
    } finally {
      setDownloading(null);
    }
  };

  const downloadCsv = async () => {
    setDownloading("csv");
    try {
      const range = type === "daily" ? "24h" : "7d";
      await downloadFile(`/reports/export?dataset=telemetry&range=${range}`, `cloudpulse-telemetry-${range}.csv`);
      toast.success("CSV export generated", "Telemetry rows matching the report window were downloaded.");
    } catch (error) {
      toast.error("CSV export failed", error instanceof Error ? error.message : undefined);
    } finally {
      setDownloading(null);
    }
  };

  const availabilityPreview = useMemo(() => (report?.servers || []).slice(0, 6), [report?.servers]);

  if (previewApi.loading && !report) return <PageSkeleton />;
  if (previewApi.error && !report) {
    return <ErrorState message={previewApi.error} onRetry={() => void previewApi.refresh()} />;
  }
  if (!report) return <ErrorState message="No report data returned." onRetry={() => void previewApi.refresh()} />;

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        eyebrow="Reporting"
        title="Operational reports"
        description="Generate a branded daily or weekly brief with availability, alert and anomaly evidence, then export as PDF or CSV."
        actions={
          <>
            <SegmentedControl
              value={type}
              onChange={setType}
              options={[
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
              ]}
              size="sm"
            />
            <input
              type="date"
              value={date}
              max={localDateInput()}
              onChange={(event) => setDate(event.target.value)}
              className="h-8 rounded-lg border border-line/20 bg-canvas/40 px-2 text-[10px] text-muted outline-none transition focus:border-accent/50"
              aria-label="Report anchor date"
            />
            <Button
              variant="secondary"
              size="sm"
              icon={<Table2 className="h-3.5 w-3.5" />}
              loading={downloading === "csv"}
              onClick={() => void downloadCsv()}
            >
              CSV
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<FileDown className="h-3.5 w-3.5" />}
              loading={downloading === "pdf"}
              onClick={() => void downloadPdf()}
            >
              Download PDF
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line/12 bg-panel/40 px-3.5 py-2.5 text-[10px] text-muted">
        <span className="flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5 text-accent" /> {report.period}
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-accent" /> Generated {timeAgo(report.generated_at)}
        </span>
        <span className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-accent" /> {report.summary.samples.toLocaleString()} telemetry samples
        </span>
        <span className="ml-auto flex items-center gap-2">
          <Tag className={report.data_source === "simulated" ? "text-warning" : "text-positive"}>
            {report.data_source === "simulated" ? "Simulated demo data" : "Live telemetry"}
          </Tag>
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className={cn("h-3.5 w-3.5", previewApi.loading && "animate-spin")} />}
            onClick={() => void previewApi.refresh()}
          >
            Rebuild preview
          </Button>
        </span>
      </div>

      {mode === "demo" && (
        <div className="flex items-start gap-2.5 rounded-xl border border-warning/20 bg-warning/[0.055] px-3.5 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-[11px] leading-relaxed text-warning/90">
            <span className="font-semibold">Demo report.</span> This brief contains simulated telemetry. The PDF is
            explicitly labelled and is suitable for evaluating the reporting pipeline, not for production compliance.
          </p>
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-12">
        <section className="card overflow-hidden xl:col-span-8">
          {/* Branded report preview */}
          <div className="relative border-b border-line/12 bg-gradient-to-br from-panel/70 via-panel/40 to-canvas/20 px-5 py-5">
            <div className="pointer-events-none absolute right-5 top-4 text-[54px] font-semibold tracking-tighter text-line/[0.055]">
              CP
            </div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow">CloudPulse · Operations brief</p>
                <h2 className="mt-1.5 text-xl font-semibold tracking-[-0.03em] text-ink">{report.title}</h2>
                <p className="mt-1 text-[10px] text-muted">
                  {formatDate(report.start)} → {formatInclusiveEnd(report.end)} · {report.period}
                </p>
              </div>
              <span
                className={cn(
                  "chip shrink-0",
                  report.data_source === "simulated"
                    ? "border-warning/30 bg-warning/10 text-warning"
                    : "border-positive/30 bg-positive/10 text-positive",
                )}
              >
                {report.data_source === "simulated" ? "Simulated demo" : "Live data"}
              </span>
            </div>
            <p className="mt-3 max-w-2xl text-[10px] leading-relaxed text-muted">
              Prepared by CloudPulse for infrastructure stakeholders. Includes fleet availability, resource trends,
              threshold alerts and Isolation Forest anomaly evidence for the reporting period.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-px bg-line/10 sm:grid-cols-3">
            {[
              { label: "Monitored targets", value: `${report.summary.servers}`, icon: ServerIcon },
              { label: "Average CPU", value: formatPercent(report.summary.avg_cpu), icon: BarChart3 },
              { label: "Average memory", value: formatPercent(report.summary.avg_memory), icon: Gauge },
              { label: "Fleet availability", value: formatPercent(report.summary.avg_availability), icon: ShieldCheck },
              { label: "Open alerts", value: `${report.summary.active_alerts}`, icon: AlertTriangle },
              { label: "Anomalies", value: `${report.summary.anomalies}`, icon: BrainCircuit },
            ].map((metric) => {
              const Icon = metric.icon;
              return (
                <div key={metric.label} className="bg-canvas/35 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[8px] font-semibold uppercase tracking-[0.12em] text-muted/65">{metric.label}</p>
                    <Icon className="h-3 w-3 text-muted/40" />
                  </div>
                  <p className="mt-1 font-mono text-base font-semibold text-ink">{metric.value}</p>
                </div>
              );
            })}
          </div>

          <div className="px-4 pt-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-semibold text-ink">Fleet trend</p>
              <span className="text-[9px] text-muted">{report.series.length} buckets</span>
            </div>
            {report.series.length > 1 ? (
              <TrendChart
                data={report.series}
                series={REPORT_SERIES}
                range={type === "daily" ? "24h" : "7d"}
                height={200}
                yDomain={[0, 100]}
              />
            ) : (
              <p className="py-8 text-center text-[10px] text-muted">Insufficient samples for a trend.</p>
            )}
          </div>

          <div className="px-4 pb-5 pt-4">
            <p className="mb-2 text-[11px] font-semibold text-ink">Availability by target</p>
            {availabilityPreview.length ? (
              <div className="space-y-2">
                {availabilityPreview.map((server) => (
                  <div key={server.id}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-[10px]">
                        <span className="truncate text-ink">{server.name}</span>
                        {server.data_source === "simulated" && <Tag className="text-warning">demo</Tag>}
                      </span>
                      <span className="font-mono text-[10px] text-ink">{formatPercent(server.availability)}</span>
                    </div>
                    <ProgressBar
                      value={server.availability}
                      color={server.availability >= 99.5 ? CHART.emerald : server.availability >= 95 ? CHART.amber : CHART.red}
                      height="h-1"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-4 text-center text-[10px] text-muted">No targets registered in this period.</p>
            )}
          </div>
        </section>

        <div className="space-y-3 xl:col-span-4">
          <section className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h2 className="text-[13px] font-semibold text-ink">Report contents</h2>
                <p className="mt-0.5 text-[10px] text-muted">Included in the generated PDF.</p>
              </div>
              <FileText className="h-4 w-4 text-accent" />
            </div>
            <div className="space-y-1.5">
              {[
                "Executive summary and fleet KPIs",
                "Availability table for every target",
                "CPU, memory and network trend charts",
                "Active and resolved alert evidence",
                "Isolation Forest anomaly evidence",
                "Cost run-rate estimate and caveats",
                "Explicit data-source labelling",
              ].map((item) => (
                <p key={item} className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-positive" /> {item}
                </p>
              ))}
            </div>
            <div className="mt-3 border-t border-line/10 pt-3">
              <Button
                variant="primary"
                size="sm"
                className="w-full"
                icon={<Download className="h-3.5 w-3.5" />}
                loading={downloading === "pdf"}
                onClick={() => void downloadPdf()}
              >
                Generate branded PDF
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2 w-full"
                icon={<Table2 className="h-3.5 w-3.5" />}
                loading={downloading === "csv"}
                onClick={() => void downloadCsv()}
              >
                Export raw telemetry CSV
              </Button>
            </div>
          </section>

          <section className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-ink">Evidence ledger</h2>
              <span className="text-[9px] text-muted">{report.alerts.length + report.anomalies.length} records</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="subtle-panel rounded-lg px-3 py-2">
                <p className="text-[9px] uppercase tracking-[0.12em] text-muted/65">Alerts total</p>
                <p className="mt-1 font-mono text-sm font-semibold text-ink">{report.summary.alerts_total}</p>
                <p className="text-[9px] text-muted">{report.alerts.filter((alert) => alert.severity === "critical").length} critical</p>
              </div>
              <div className="subtle-panel rounded-lg px-3 py-2">
                <p className="text-[9px] uppercase tracking-[0.12em] text-muted/65">Anomalies</p>
                <p className="mt-1 font-mono text-sm font-semibold text-ink">{report.summary.anomalies}</p>
                <p className="text-[9px] text-muted">{report.summary.critical_anomalies} critical</p>
              </div>
              <div className="subtle-panel col-span-2 rounded-lg px-3 py-2">
                <p className="text-[9px] uppercase tracking-[0.12em] text-muted/65">Estimated monthly run-rate</p>
                <p className="mt-1 font-mono text-sm font-semibold text-ink">{formatMoney(report.costs.monthly_estimated)}</p>
                <p className="mt-0.5 text-[9px] leading-relaxed text-muted">{report.costs.note}</p>
              </div>
            </div>
            <div className="mt-2 max-h-[180px] space-y-1 overflow-y-auto">
              {report.alerts.slice(0, 6).map((alert) => (
                <div key={alert.id} className="flex items-center gap-2 rounded-lg border border-line/10 bg-canvas/25 px-2.5 py-1.5">
                  <SeverityBadge severity={alert.severity} />
                  <span className="min-w-0 flex-1 truncate text-[9px] text-muted">{alert.title}</span>
                  <span className="shrink-0 text-[8px] text-muted/60">{timeAgo(alert.created_at)}</span>
                </div>
              ))}
              {report.alerts.length === 0 && (
                <p className="rounded-lg border border-line/10 bg-canvas/25 px-2.5 py-2 text-[9px] text-muted">
                  No alerts were raised in this reporting window.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-12">
        <section className="card xl:col-span-7">
          <div className="flex items-start justify-between px-4 pb-2 pt-4">
            <div>
              <h2 className="text-[13px] font-semibold text-ink">Server evidence</h2>
              <p className="mt-0.5 text-[10px] text-muted">Snapshot of every target included in the brief.</p>
            </div>
            <Tag>{report.servers.length} targets</Tag>
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
                  <th>Availability</th>
                </tr>
              </thead>
              <tbody>
                {report.servers.map((server) => (
                  <tr key={server.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="grid h-6 w-6 place-items-center rounded-md border border-line/15 bg-canvas/40 text-muted">
                          <ServerIcon className="h-3 w-3" />
                        </span>
                        <div>
                          <p className="text-[10px] font-medium text-ink">{server.name}</p>
                          <p className="font-mono text-[9px] text-muted/70">{server.hostname}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="text-[10px] capitalize text-muted">{server.status}</span>
                    </td>
                    <td>
                      <span className="font-mono text-[10px] font-semibold" style={{ color: healthColor(server.health_score) }}>
                        {Math.round(server.health_score)}
                      </span>
                    </td>
                    <td className="font-mono text-[10px] text-ink">
                      {formatPercent(server.latest_metrics?.cpu_percent ?? null)}
                    </td>
                    <td className="font-mono text-[10px] text-ink">
                      {formatPercent(server.latest_metrics?.memory_percent ?? null)}
                    </td>
                    <td className="font-mono text-[10px] text-ink">{formatPercent(server.availability)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card xl:col-span-5">
          <div className="flex items-start justify-between px-4 pb-2 pt-4">
            <div>
              <h2 className="text-[13px] font-semibold text-ink">Generated report history</h2>
              <p className="mt-0.5 text-[10px] text-muted">PDF generation is recorded with the author and summary.</p>
            </div>
            <span className="text-[9px] text-muted">{historyApi.data?.total ?? 0}</span>
          </div>
          <div className="max-h-[350px] overflow-y-auto px-2 pb-2">
            {historyApi.data?.items.length ? (
              <div className="divide-y divide-line/8">
                {historyApi.data.items.map((record) => (
                  <div key={record.id} className="flex items-start gap-2.5 px-2 py-2.5">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line/15 bg-canvas/40 text-muted">
                      <FileText className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[10px] font-semibold text-ink">{record.title}</p>
                      <p className="text-[9px] text-muted">
                        {record.created_by} · {formatDateTime(record.created_at)}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Tag>{record.format.toUpperCase()}</Tag>
                        <Tag>{record.data_source === "simulated" ? "demo" : "live"}</Tag>
                        <Tag>{record.summary.servers} targets</Tag>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<FileText className="h-5 w-5" />}
                title="No reports generated yet"
                description="Download a PDF to create the first entry in the report ledger."
                className="py-10"
              />
            )}
          </div>
        </section>
      </div>

      <div className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[10px] leading-relaxed text-muted">
          {report.notes.uptime} {report.notes.costs} Reports are generated on demand from stored telemetry; PDF files are
          not persisted server-side, only their metadata ledger entries.
        </p>
        <Button variant="secondary" size="sm" icon={<ArrowRight className="h-3.5 w-3.5" />} onClick={() => void previewApi.refresh()}>
          Refresh data
        </Button>
      </div>
    </div>
  );
}
