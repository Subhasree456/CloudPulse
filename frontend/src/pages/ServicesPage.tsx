import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudCog,
  Database,
  HardDrive,
  Layers,
  Laptop,
  Plug,
  RefreshCw,
  Server as ServerIcon,
  ShieldCheck,
  Sparkles,
  Wifi,
  XCircle,
} from "lucide-react";
import {
  Button,
  ErrorState,
  PageHeader,
  PageSkeleton,
  Tag,
} from "../components/ui";
import { useSystem } from "../context/SystemContext";
import { useApi } from "../hooks/useApi";
import { cn, formatDateTime, timeAgo } from "../lib/format";
import type { ServicesPayload } from "../types";

const ICONS: Record<string, typeof ServerIcon> = {
  server: ServerIcon,
  layers: Layers,
  cloud: Cloud,
  database: Database,
  "hard-drive": HardDrive,
  plug: Plug,
};

const KIND_META: Record<
  string,
  { label: string; className: string; description: string }
> = {
  actual: {
    label: "Actual",
    className: "border-positive/25 bg-positive/8 text-positive",
    description: "Implemented and verified in this deployment.",
  },
  simulated: {
    label: "Simulated",
    className: "border-warning/25 bg-warning/8 text-warning",
    description: "Works, but the data is generated demo telemetry.",
  },
  conceptual: {
    label: "Conceptual",
    className: "border-line/25 bg-line/8 text-muted",
    description: "Designed or referenced, not connected.",
  },
  fallback: {
    label: "Fallback",
    className: "border-accent/25 bg-accent/8 text-accent",
    description: "Active local fallback when the preferred service is unavailable.",
  },
  configuration: {
    label: "Config ready",
    className: "border-info/25 bg-info/8 text-info",
    description: "Deployment configuration exists; no live deployment is claimed.",
  },
};

export function ServicesPage() {
  const { mode } = useSystem();
  const [filter, setFilter] = useState<"all" | "actual" | "conceptual">("all");
  const servicesApi = useApi<ServicesPayload>("/services", { refreshInterval: 60_000 });

  const data = servicesApi.data;

  if (servicesApi.loading && !data) return <PageSkeleton />;
  if (servicesApi.error && !data) {
    return <ErrorState message={servicesApi.error} onRetry={() => void servicesApi.refresh()} />;
  }
  if (!data) return <ErrorState message="No service inventory returned." onRetry={() => void servicesApi.refresh()} />;

  const visibleCategories = data.categories
    .map((category) => ({
      ...category,
      items:
        filter === "all"
          ? category.items
          : category.items.filter((item) =>
              filter === "actual" ? item.kind === "actual" || item.kind === "fallback" : item.kind === "conceptual",
            ),
    }))
    .filter((category) => category.items.length > 0);

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        eyebrow="Architecture"
        title="Cloud service inventory"
        description="A deliberately honest map of what CloudPulse actually runs, what is simulated and what remains conceptual."
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className={cn("h-3.5 w-3.5", servicesApi.loading && "animate-spin")} />}
            onClick={() => void servicesApi.refresh()}
          >
            Refresh inventory
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Live targets", value: data.summary.live_targets, icon: Wifi, tone: "text-positive" },
          { label: "Demo targets", value: data.summary.demo_targets, icon: Laptop, tone: "text-warning" },
          { label: "Enrolled agents", value: data.summary.enrolled_agents, icon: ShieldCheck, tone: "text-accent" },
          { label: "Conceptual services", value: data.summary.conceptual_services, icon: CloudCog, tone: "text-muted" },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="card flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted/70">{item.label}</p>
                <p className="mt-1 font-mono text-xl font-semibold text-ink">{item.value}</p>
              </div>
              <span className={cn("grid h-8 w-8 place-items-center rounded-lg border border-line/15 bg-canvas/40", item.tone)}>
                <Icon className="h-4 w-4" />
              </span>
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 xl:grid-cols-12">
        <section className="card xl:col-span-8">
          <div className="flex flex-wrap items-center gap-2 border-b border-line/10 px-4 py-3">
            <div>
              <h2 className="text-[13px] font-semibold text-ink">Service layers</h2>
              <p className="mt-0.5 text-[10px] text-muted">
                IaaS → PaaS → SaaS, plus DBaaS, storage and integrations.
              </p>
            </div>
            <div className="ml-auto flex rounded-lg border border-line/15 bg-canvas/35 p-0.5">
              {[
                { value: "all" as const, label: "All" },
                { value: "actual" as const, label: "Running" },
                { value: "conceptual" as const, label: "Conceptual" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilter(option.value)}
                  className={cn(
                    "h-7 rounded-md px-2.5 text-[10px] font-semibold transition",
                    filter === option.value ? "bg-panel text-ink ring-1 ring-line/15" : "text-muted hover:text-ink",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 p-3">
            {visibleCategories.map((category) => {
              const Icon = ICONS[category.icon] || ServerIcon;
              return (
                <div key={category.id} className="rounded-xl border border-line/12 bg-canvas/20">
                  <div className="flex items-start gap-3 border-b border-line/8 px-3.5 py-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line/15 bg-panel/60 text-accent">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-accent">
                          {category.acronym}
                        </span>
                        <p className="text-[11px] font-semibold text-ink">{category.name}</p>
                        <span
                          className={cn(
                            "chip",
                            category.status === "live"
                              ? "border-positive/20 bg-positive/8 text-positive"
                              : category.status === "simulated"
                                ? "border-warning/20 bg-warning/8 text-warning"
                                : "border-line/20 bg-line/5 text-muted",
                          )}
                        >
                          {category.status.replace("_", " ")}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-muted">{category.description}</p>
                    </div>
                  </div>
                  <div className="divide-y divide-line/8">
                    {category.items.map((item) => {
                      const meta = KIND_META[item.kind] || KIND_META.conceptual;
                      return (
                        <div key={item.name} className="flex items-start gap-3 px-3.5 py-2.5">
                          <span
                            className={cn(
                              "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border",
                              item.verified
                                ? "border-positive/20 bg-positive/8 text-positive"
                                : "border-line/20 bg-line/5 text-muted",
                            )}
                          >
                            {item.verified ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="text-[10px] font-semibold text-ink">{item.name}</p>
                              <span className={cn("chip", meta.className)}>{meta.label}</span>
                            </div>
                            <p className="mt-0.5 text-[9px] leading-relaxed text-muted">{item.detail}</p>
                          </div>
                          <span className="hidden shrink-0 text-[9px] text-muted/60 sm:block">{item.status}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="space-y-3 xl:col-span-4">
          <section className="card p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg border border-accent/20 bg-accent/8 text-accent">
                <Database className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-[13px] font-semibold text-ink">Persistence status</h2>
                <p className="text-[10px] text-muted">Runtime database selection</p>
              </div>
            </div>
            <div className="rounded-xl border border-line/12 bg-canvas/25 p-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-muted">Active backend</p>
                <span
                  className={cn(
                    "chip",
                    data.database.backend === "mongodb"
                      ? "border-positive/25 bg-positive/8 text-positive"
                      : "border-accent/25 bg-accent/8 text-accent",
                  )}
                >
                  {data.database.backend === "mongodb" ? "MongoDB Atlas" : "SQLite fallback"}
                </span>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-muted">{data.database.detail}</p>
              <div className="mt-2 flex items-center gap-1.5 text-[9px]">
                {data.database.connected ? (
                  <>
                    <CheckCircle2 className="h-3 w-3 text-positive" /> Connected
                  </>
                ) : (
                  <>
                    <XCircle className="h-3 w-3 text-danger" /> Disconnected
                  </>
                )}
                <span className="ml-auto text-muted/60">Mode: {data.mode}</span>
              </div>
            </div>
          </section>

          <section className="card p-4">
            <h2 className="text-[13px] font-semibold text-ink">Legend</h2>
            <p className="mt-0.5 text-[10px] text-muted">Every row in the inventory uses one of these states.</p>
            <div className="mt-2 space-y-2">
              {Object.entries(KIND_META).map(([key, meta]) => (
                <div key={key} className="flex items-start gap-2">
                  <span className={cn("chip shrink-0", meta.className)}>{meta.label}</span>
                  <p className="text-[9px] leading-relaxed text-muted">{meta.description}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="card border-warning/20 p-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div>
                <h2 className="text-[12px] font-semibold text-ink">Honesty statement</h2>
                <p className="mt-1 text-[10px] leading-relaxed text-muted">{data.disclaimer}</p>
                <p className="mt-2 text-[9px] text-muted/60">
                  Inventory generated {formatDateTime(data.generated_at)} · {timeAgo(data.generated_at)}
                </p>
              </div>
            </div>
          </section>

          <section className="card p-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              <h2 className="text-[12px] font-semibold text-ink">What this means</h2>
            </div>
            <div className="mt-2 space-y-2 text-[10px] leading-relaxed text-muted">
              <p>
                <span className="font-semibold text-ink">Actual</span> entries are exercised by the running code.{" "}
                <span className="font-semibold text-ink">Simulated</span> entries use the demo generator and are labelled
                on every page.
              </p>
              <p>
                AWS, Azure, GCP, CloudWatch, object storage and hosted installer integrations are <strong>not</strong>{" "}
                connected. No credentials exist in this workspace, and no deployment is claimed.
              </p>
              <p className="flex items-center gap-1.5">
                <Wifi className="h-3 w-3 text-accent" /> Mode: <Tag>{mode}</Tag>
                {data.data_source === "simulated" ? "demo telemetry" : "live telemetry"}
              </p>
            </div>
          </section>
        </div>
      </div>

      <div className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-[10px] text-muted">
          <CloudCog className="h-4 w-4 text-accent" />
          {data.summary.integrated_services} verified capabilities · {data.summary.conceptual_services} conceptual
          integrations · {data.summary.live_targets} live targets.
        </div>
        <span className="text-[9px] text-muted/60">Simulated targets are labelled everywhere they appear.</span>
      </div>
    </div>
  );
}
