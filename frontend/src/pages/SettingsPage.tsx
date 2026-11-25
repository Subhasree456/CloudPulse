import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BellRing,
  Check,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  Gauge,
  HardDrive,
  KeyRound,
  Laptop,
  Lock,
  Mail,
  MemoryStick,
  MonitorCog,
  Palette,
  Radio,
  RefreshCw,
  Save,
  Server as ServerIcon,
  ShieldCheck,
  Sparkles,
  Timer,
  User,
  Users,
  Wifi,
} from "lucide-react";
import {
  Button,
  ConfirmDialog,
  ErrorState,
  FormField,
  Input,
  PageHeader,
  PageSkeleton,
  Select,
  Toggle,
} from "../components/ui";
import { useApi } from "../hooks/useApi";
import { useAuth } from "../context/AuthContext";
import { useSystem } from "../context/SystemContext";
import { useToast } from "../context/ToastContext";
import { API_BASE } from "../lib/api";
import { useTheme, type AccentName, type ThemeName } from "../context/ThemeContext";
import { cn, formatPercent, timeAgo, titleCase } from "../lib/format";
import type { MonitoringSettings, User as UserType } from "../types";

type Tab = "monitoring" | "thresholds" | "account" | "system";

const TABS: { value: Tab; label: string; icon: typeof Gauge }[] = [
  { value: "monitoring", label: "Monitoring", icon: MonitorCog },
  { value: "thresholds", label: "Thresholds", icon: BellRing },
  { value: "account", label: "Account", icon: User },
  { value: "system", label: "System", icon: Database },
];

const THRESHOLD_ROWS = [
  { key: "cpu", label: "CPU utilisation", unit: "%", icon: Activity, max: 100 },
  { key: "memory", label: "Memory utilisation", unit: "%", icon: MemoryStick, max: 100 },
  { key: "disk", label: "Disk utilisation", unit: "%", icon: HardDrive, max: 100 },
  { key: "response_time_ms", label: "Response time", unit: "ms", icon: Timer, max: 600000 },
  { key: "network_mbps", label: "Network throughput", unit: "Mbps", icon: Wifi, max: 100000 },
];

const THEMES: { value: ThemeName; label: string; swatch: string }[] = [
  { value: "navy", label: "Deep navy", swatch: "linear-gradient(135deg, #060b17, #0d1526)" },
  { value: "midnight", label: "Midnight violet", swatch: "linear-gradient(135deg, #070512, #120d22)" },
  { value: "slate", label: "Slate blue", swatch: "linear-gradient(135deg, #090f1b, #141e30)" },
];

const ACCENTS: { value: AccentName; label: string; color: string }[] = [
  { value: "cyan", label: "Cyan", color: "#22d3ee" },
  { value: "violet", label: "Violet", color: "#a78bfa" },
  { value: "emerald", label: "Emerald", color: "#34d399" },
  { value: "amber", label: "Amber", color: "#fbbf24" },
];

interface SettingsDraft {
  monitoring_interval_seconds: number;
  offline_after_seconds: number;
  retention_days: number;
  anomaly_detection_enabled: boolean;
  auto_resolve_availability: boolean;
}

function fromSettings(settings: MonitoringSettings): SettingsDraft {
  return {
    monitoring_interval_seconds: settings.monitoring_interval_seconds,
    offline_after_seconds: settings.offline_after_seconds,
    retention_days: settings.retention_days,
    anomaly_detection_enabled: settings.anomaly_detection_enabled,
    auto_resolve_availability: settings.auto_resolve_availability,
  };
}

export function SettingsPage() {
  const { user, isAdmin, updateUser, acceptSession } = useAuth();
  const { settings, system, mode, updateMode, saveSettings, refresh } = useSystem();
  const { theme, accent, reducedMotion, setTheme, setAccent, setReducedMotion } = useTheme();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("monitoring");
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [thresholds, setThresholds] = useState<MonitoringSettings["thresholds"] | null>(null);
  const [saving, setSaving] = useState<"monitoring" | "thresholds" | null>(null);
  const [modeConfirm, setModeConfirm] = useState(false);
  const [modeLoading, setModeLoading] = useState(false);
  const [profile, setProfile] = useState({ name: user?.name || "", email: user?.email || "" });
  const [profileSaving, setProfileSaving] = useState(false);
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [passwordSaving, setPasswordSaving] = useState(false);

  const usersApi = useApi<{ items: UserType[]; total: number }>(isAdmin ? "/auth/users" : null);

  useEffect(() => {
    if (settings) {
      setDraft(fromSettings(settings));
      setThresholds(JSON.parse(JSON.stringify(settings.thresholds)));
    }
  }, [settings]);

  useEffect(() => {
    setProfile({ name: user?.name || "", email: user?.email || "" });
  }, [user?.name, user?.email]);

  const thresholdErrors = useMemo(() => {
    if (!thresholds) return [];
    const errors: string[] = [];
    for (const row of THRESHOLD_ROWS) {
      const pair = thresholds[row.key];
      if (!pair) continue;
      if (!Number.isFinite(pair.warning) || !Number.isFinite(pair.critical)) {
        errors.push(`${row.label}: values must be numeric.`);
      } else if (pair.warning >= pair.critical) {
        errors.push(`${row.label}: warning must be lower than critical.`);
      }
    }
    if (draft && draft.offline_after_seconds < draft.monitoring_interval_seconds * 3) {
      errors.push("Offline threshold should be at least three collection intervals.");
    }
    return errors;
  }, [thresholds, draft]);

  if (!settings || !system || !draft || !thresholds) return <PageSkeleton />;

  const saveMonitoring = async () => {
    if (!isAdmin) return;
    setSaving("monitoring");
    try {
      const message = await saveSettings(draft);
      toast.success("Monitoring settings saved", message);
    } catch (error) {
      toast.error("Unable to save settings", error instanceof Error ? error.message : undefined);
    } finally {
      setSaving(null);
    }
  };

  const saveThresholds = async () => {
    if (!isAdmin) return;
    if (thresholdErrors.length) {
      toast.warning("Check threshold values", thresholdErrors[0]);
      return;
    }
    setSaving("thresholds");
    try {
      const message = await saveSettings({ thresholds });
      toast.success("Threshold policy saved", message);
    } catch (error) {
      toast.error("Unable to save thresholds", error instanceof Error ? error.message : undefined);
    } finally {
      setSaving(null);
    }
  };

  const switchMode = async () => {
    const target = mode === "demo" ? "live" : "demo";
    setModeLoading(true);
    try {
      const message = await updateMode(target);
      toast.success(target === "demo" ? "Demo mode enabled" : "Live mode enabled", message);
      setModeConfirm(false);
      await refresh();
    } catch (error) {
      toast.error("Unable to switch mode", error instanceof Error ? error.message : undefined);
    } finally {
      setModeLoading(false);
    }
  };

  const saveProfile = async () => {
    setProfileSaving(true);
    try {
      const response = await fetch(`${API_BASE}/auth/profile`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("cloudpulse_token") || ""}`,
        },
        body: JSON.stringify({ name: profile.name, email: profile.email }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || "Unable to update profile.");
      updateUser(payload.user);
      toast.success("Profile updated");
    } catch (error) {
      toast.error("Profile update failed", error instanceof Error ? error.message : undefined);
    } finally {
      setProfileSaving(false);
    }
  };

  const changePassword = async () => {
    if (passwords.next.length < 8) {
      toast.warning("Password too short", "Use at least 8 characters.");
      return;
    }
    if (passwords.next !== passwords.confirm) {
      toast.warning("Passwords do not match");
      return;
    }
    setPasswordSaving(true);
    try {
      const response = await fetch(`${API_BASE}/auth/password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("cloudpulse_token") || ""}`,
        },
        body: JSON.stringify({ current_password: passwords.current, new_password: passwords.next }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || "Unable to change password.");
      acceptSession(payload.token, payload.user);
      setPasswords({ current: "", next: "", confirm: "" });
      toast.success("Password changed", payload.message);
    } catch (error) {
      toast.error("Password change failed", error instanceof Error ? error.message : undefined);
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        eyebrow="Configuration"
        title="Workspace settings"
        description="Control telemetry collection, threshold policy, account security and visual preferences."
        actions={
          <span className="chip border-line/20 bg-line/5 text-muted">
            <ShieldCheck className="h-3 w-3" /> {isAdmin ? "Administrator" : "Viewer · read-only"}
          </span>
        }
      />

      <div className="flex flex-wrap gap-1 rounded-xl border border-line/15 bg-canvas/35 p-1">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => setTab(item.value)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold transition",
                tab === item.value ? "bg-panel text-ink shadow-sm ring-1 ring-line/15" : "text-muted hover:text-ink",
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {item.label}
            </button>
          );
        })}
      </div>

      {tab === "monitoring" && (
        <div className="grid gap-3 xl:grid-cols-12">
          <div className="space-y-3 xl:col-span-7">
            <section className="card p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[13px] font-semibold text-ink">Data mode</h2>
                  <p className="mt-0.5 text-[10px] text-muted">
                    Determines whether dashboards read simulated demo telemetry or live agent frames.
                  </p>
                </div>
                <span
                  className={cn(
                    "chip shrink-0",
                    mode === "demo" ? "border-warning/25 bg-warning/8 text-warning" : "border-positive/25 bg-positive/8 text-positive",
                  )}
                >
                  {mode === "demo" ? "Demo" : "Live"}
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!isAdmin || mode === "demo") return;
                    setModeConfirm(true);
                  }}
                  disabled={!isAdmin}
                  className={cn(
                    "rounded-xl border p-3 text-left transition",
                    mode === "demo" ? "border-warning/30 bg-warning/[0.06]" : "border-line/15 bg-canvas/25 hover:border-line/30",
                  )}
                >
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                    <Sparkles className="h-3.5 w-3.5 text-warning" /> Demo monitoring
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted">
                    Generates realistic simulated telemetry for eight targets. Clearly labelled across all views.
                  </p>
                  {mode === "demo" && (
                    <span className="mt-2 inline-flex items-center gap-1 text-[9px] font-semibold text-warning">
                      <Check className="h-3 w-3" /> Active
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!isAdmin || mode === "live") return;
                    setModeConfirm(true);
                  }}
                  disabled={!isAdmin}
                  className={cn(
                    "rounded-xl border p-3 text-left transition",
                    mode === "live" ? "border-positive/30 bg-positive/[0.06]" : "border-line/15 bg-canvas/25 hover:border-line/30",
                  )}
                >
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                    <Radio className="h-3.5 w-3.5 text-positive" /> Live monitoring
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted">
                    Starts the local psutil collector and shows only targets with agent heartbeats.
                  </p>
                  {mode === "live" && (
                    <span className="mt-2 inline-flex items-center gap-1 text-[9px] font-semibold text-positive">
                      <Check className="h-3 w-3" /> Active
                    </span>
                  )}
                </button>
              </div>
              {!isAdmin && (
                <p className="mt-2 text-[9px] text-muted">Only administrators can change the monitoring mode.</p>
              )}
            </section>

            <section className="card p-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-[13px] font-semibold text-ink">Collection & retention</h2>
                  <p className="mt-0.5 text-[10px] text-muted">Applied by the backend workers immediately after saving.</p>
                </div>
                <Clock className="h-4 w-4 text-accent" />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Collection interval (seconds)" hint="2–3600s. Demo generator and local collector both honour this.">
                  <Input
                    type="number"
                    min={2}
                    max={3600}
                    value={draft.monitoring_interval_seconds}
                    disabled={!isAdmin}
                    onChange={(event) =>
                      setDraft({ ...draft, monitoring_interval_seconds: Number(event.target.value) || 0 })
                    }
                  />
                </FormField>
                <FormField label="Offline after (seconds)" hint={`Effective watchdog threshold: ${Math.max(draft.offline_after_seconds, draft.monitoring_interval_seconds * 3)}s.`}>
                  <Input
                    type="number"
                    min={10}
                    max={86400}
                    value={draft.offline_after_seconds}
                    disabled={!isAdmin}
                    onChange={(event) => setDraft({ ...draft, offline_after_seconds: Number(event.target.value) || 0 })}
                  />
                </FormField>
                <FormField label="Telemetry retention (days)" hint="Older rows are removed by the hourly cleanup worker.">
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={draft.retention_days}
                    disabled={!isAdmin}
                    onChange={(event) => setDraft({ ...draft, retention_days: Number(event.target.value) || 0 })}
                  />
                </FormField>
                <div className="space-y-2.5 pt-1">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-medium text-ink">Anomaly detection</p>
                      <p className="text-[9px] text-muted">Scheduled Isolation Forest scans.</p>
                    </div>
                    <Toggle
                      checked={draft.anomaly_detection_enabled}
                      disabled={!isAdmin}
                      onChange={(value) => setDraft({ ...draft, anomaly_detection_enabled: value })}
                      label="Toggle anomaly detection"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-medium text-ink">Auto-resolve availability</p>
                      <p className="text-[9px] text-muted">Close incidents when heartbeat returns.</p>
                    </div>
                    <Toggle
                      checked={draft.auto_resolve_availability}
                      disabled={!isAdmin}
                      onChange={(value) => setDraft({ ...draft, auto_resolve_availability: value })}
                      label="Toggle availability auto-resolution"
                    />
                  </div>
                </div>
              </div>

              {thresholdErrors.length > 0 && (
                <p className="mt-3 rounded-lg border border-danger/20 bg-danger/8 px-3 py-2 text-[10px] text-danger">
                  {thresholdErrors[0]}
                </p>
              )}

              <div className="mt-3 flex justify-end border-t border-line/10 pt-3">
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Save className="h-3.5 w-3.5" />}
                  disabled={!isAdmin}
                  loading={saving === "monitoring"}
                  onClick={() => void saveMonitoring()}
                >
                  Save monitoring settings
                </Button>
              </div>
            </section>
          </div>

          <div className="space-y-3 xl:col-span-5">
            <section className="card p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg border border-accent/20 bg-accent/8 text-accent">
                  <ServerIcon className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-[13px] font-semibold text-ink">Runtime status</h2>
                  <p className="text-[10px] text-muted">Current API and worker state.</p>
                </div>
              </div>
              <div className="space-y-1.5">
                {[
                  { label: "Environment", value: titleCase(system.environment) },
                  { label: "API version", value: system.version },
                  { label: "Database", value: system.database_backend === "mongodb" ? "MongoDB Atlas" : "SQLite fallback" },
                  { label: "Background workers", value: system.background_workers ? "Running" : "Disabled" },
                  { label: "Local collector", value: system.local_collector_enabled ? "Enabled" : "Disabled" },
                  { label: "Agent enrollment", value: system.agent_enrollment_enabled ? "Token configured" : "Disabled" },
                  { label: "API latency", value: `${system.api_latency_ms.toFixed(1)} ms` },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between border-b border-line/8 py-1.5 text-[10px] last:border-0">
                    <span className="text-muted">{row.label}</span>
                    <span className="font-medium text-ink">{row.value}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[9px] leading-relaxed text-muted/60">{system.database_detail}</p>
            </section>

            <section className="card p-4">
              <div className="mb-2 flex items-center gap-2">
                <Gauge className="h-4 w-4 text-accent" />
                <h2 className="text-[13px] font-semibold text-ink">Current policy</h2>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-muted">CPU warning / critical</span>
                  <span className="font-mono text-ink">
                    {formatPercent(settings.thresholds.cpu.warning, 0)} / {formatPercent(settings.thresholds.cpu.critical, 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-muted">Memory warning / critical</span>
                  <span className="font-mono text-ink">
                    {formatPercent(settings.thresholds.memory.warning, 0)} / {formatPercent(settings.thresholds.memory.critical, 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-muted">Retention</span>
                  <span className="font-mono text-ink">{settings.retention_days} days</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTab("thresholds")}
                className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-accent"
              >
                Edit threshold policy <Gauge className="h-3 w-3" />
              </button>
            </section>
          </div>
        </div>
      )}

      {tab === "thresholds" && (
        <div className="grid gap-3 xl:grid-cols-12">
          <section className="card xl:col-span-8">
            <div className="flex items-start justify-between px-4 pb-2 pt-4">
              <div>
                <h2 className="text-[13px] font-semibold text-ink">Threshold policy</h2>
                <p className="mt-0.5 text-[10px] text-muted">
                  Warning and critical boundaries per metric. Alerts are deduplicated per target and category.
                </p>
              </div>
              <BellRing className="h-4 w-4 text-accent" />
            </div>
            <div className="space-y-2 px-4 pb-4">
              {THRESHOLD_ROWS.map((row) => {
                const Icon = row.icon;
                const pair = thresholds[row.key];
                return (
                  <div key={row.key} className="rounded-xl border border-line/12 bg-canvas/25 px-3.5 py-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="grid h-7 w-7 place-items-center rounded-lg border border-line/15 bg-panel/50 text-muted">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <p className="text-[11px] font-semibold text-ink">{row.label}</p>
                      <span className="ml-auto text-[9px] uppercase tracking-[0.1em] text-muted/60">{row.unit}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[9px] font-medium uppercase tracking-[0.08em] text-warning/80">
                          Warning
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={row.max}
                          step={row.unit === "%" ? 1 : 1}
                          value={pair?.warning ?? 0}
                          disabled={!isAdmin}
                          onChange={(event) =>
                            setThresholds({
                              ...thresholds,
                              [row.key]: { ...pair, warning: Number(event.target.value) || 0 },
                            })
                          }
                          className={cn(
                            "input h-8 font-mono text-[11px]",
                            pair && pair.warning >= pair.critical && "border-danger/40",
                          )}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[9px] font-medium uppercase tracking-[0.08em] text-danger/80">
                          Critical
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={row.max}
                          step={1}
                          value={pair?.critical ?? 0}
                          disabled={!isAdmin}
                          onChange={(event) =>
                            setThresholds({
                              ...thresholds,
                              [row.key]: { ...pair, critical: Number(event.target.value) || 0 },
                            })
                          }
                          className={cn(
                            "input h-8 font-mono text-[11px]",
                            pair && pair.warning >= pair.critical && "border-danger/40",
                          )}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/10 px-4 py-3">
              <p className="text-[9px] leading-relaxed text-muted">
                Warning must be lower than critical. Changes apply to future evaluations; existing alerts keep their
                recorded thresholds.
              </p>
              <Button
                variant="primary"
                size="sm"
                icon={<Save className="h-3.5 w-3.5" />}
                loading={saving === "thresholds"}
                disabled={!isAdmin}
                onClick={() => void saveThresholds()}
              >
                Save policy
              </Button>
            </div>
          </section>

          <aside className="space-y-3 xl:col-span-4">
            <section className="card p-4">
              <h2 className="text-[13px] font-semibold text-ink">How evaluation works</h2>
              <div className="mt-2 space-y-2 text-[10px] leading-relaxed text-muted">
                <p>
                  Every ingested sample is checked against the active policy. A warning breach opens a warning alert; a
                  critical breach escalates the same deduplicated alert instead of creating another row.
                </p>
                <p>
                  Recovery is manual by default to preserve an audit trail. Availability alerts can be auto-resolved
                  when a heartbeat returns, if that option is enabled.
                </p>
                <p>
                  Alert rows store the observed value, boundary and unit so the evidence remains understandable after a
                  policy change.
                </p>
              </div>
            </section>
            <section className="card border-warning/20 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p className="text-[10px] leading-relaxed text-muted">
                  Very low thresholds on noisy hosts can create alert storms. CloudPulse deduplicates per target and
                  category, but tuning matters. Demo mode is safe for experimentation.
                </p>
              </div>
            </section>
          </aside>
        </div>
      )}

      {tab === "account" && (
        <div className="grid gap-3 xl:grid-cols-12">
          <div className="space-y-3 xl:col-span-7">
            <section className="card p-4">
              <div className="mb-3 flex items-center gap-2">
                <User className="h-4 w-4 text-accent" />
                <h2 className="text-[13px] font-semibold text-ink">Profile</h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Full name">
                  <div className="relative">
                    <User className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                    <Input
                      value={profile.name}
                      onChange={(event) => setProfile({ ...profile, name: event.target.value })}
                      className="pl-9"
                    />
                  </div>
                </FormField>
                <FormField label="Email address">
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                    <Input
                      type="email"
                      value={profile.email}
                      onChange={(event) => setProfile({ ...profile, email: event.target.value })}
                      className="pl-9"
                    />
                  </div>
                </FormField>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-line/10 pt-3">
                <p className="text-[9px] text-muted">
                  Role: <span className="font-semibold text-ink">{user?.role === "admin" ? "Administrator" : "Viewer"}</span> ·
                  Joined {user?.created_at ? timeAgo(user.created_at) : "—"}
                </p>
                <Button variant="primary" size="sm" icon={<Save className="h-3.5 w-3.5" />} loading={profileSaving} onClick={() => void saveProfile()}>
                  Save profile
                </Button>
              </div>
            </section>

            <section className="card p-4">
              <div className="mb-3 flex items-center gap-2">
                <Lock className="h-4 w-4 text-accent" />
                <h2 className="text-[13px] font-semibold text-ink">Password</h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField label="Current password">
                  <Input
                    type="password"
                    value={passwords.current}
                    onChange={(event) => setPasswords({ ...passwords, current: event.target.value })}
                    autoComplete="current-password"
                  />
                </FormField>
                <FormField label="New password">
                  <Input
                    type="password"
                    value={passwords.next}
                    onChange={(event) => setPasswords({ ...passwords, next: event.target.value })}
                    autoComplete="new-password"
                  />
                </FormField>
                <FormField label="Confirm new password">
                  <Input
                    type="password"
                    value={passwords.confirm}
                    onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })}
                    autoComplete="new-password"
                  />
                </FormField>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-line/10 pt-3">
                <p className="text-[9px] text-muted">Changing the password revokes other sessions.</p>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<KeyRound className="h-3.5 w-3.5" />}
                  loading={passwordSaving}
                  onClick={() => void changePassword()}
                >
                  Update password
                </Button>
              </div>
            </section>

            {isAdmin && (
              <section className="card p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-accent" />
                    <h2 className="text-[13px] font-semibold text-ink">Workspace users</h2>
                  </div>
                  <span className="text-[9px] text-muted">{usersApi.data?.total ?? 0} accounts</span>
                </div>
                <div className="space-y-1.5">
                  {(usersApi.data?.items || []).map((account) => (
                    <div key={account.id} className="flex items-center gap-2.5 rounded-lg border border-line/10 bg-canvas/25 px-3 py-2">
                      <span className="grid h-6 w-6 place-items-center rounded-full border border-accent/20 bg-accent/8 text-[8px] font-semibold text-accent">
                        {account.name.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[10px] font-medium text-ink">{account.name}</p>
                        <p className="truncate text-[9px] text-muted">{account.email}</p>
                      </div>
                      <span className={cn("chip", account.role === "admin" ? "border-accent/20 bg-accent/8 text-accent" : "border-line/20 bg-line/5 text-muted")}>
                        {account.role}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="space-y-3 xl:col-span-5">
            <section className="card p-4">
              <div className="mb-2 flex items-center gap-2">
                <Palette className="h-4 w-4 text-accent" />
                <h2 className="text-[13px] font-semibold text-ink">Appearance</h2>
              </div>
              <p className="text-[10px] text-muted">Saved locally for this browser.</p>
              <div className="mt-3 space-y-2">
                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted/65">Theme</p>
                <div className="grid grid-cols-3 gap-2">
                  {THEMES.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setTheme(item.value)}
                      className={cn(
                        "rounded-lg border p-1.5 text-left transition",
                        theme === item.value ? "border-accent/50 ring-1 ring-accent/20" : "border-line/15 hover:border-line/30",
                      )}
                    >
                      <span className="block h-8 w-full rounded-md border border-line/10" style={{ background: item.swatch }} />
                      <span className="mt-1 block text-[9px] text-muted">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 space-y-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted/65">Accent</p>
                <div className="flex gap-2">
                  {ACCENTS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setAccent(item.value)}
                      className={cn(
                        "flex h-7 items-center gap-1.5 rounded-full border px-2 text-[9px] font-medium transition",
                        accent === item.value ? "border-accent/40 bg-accent/8 text-ink" : "border-line/15 text-muted hover:text-ink",
                      )}
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-line/10 pt-3">
                <div>
                  <p className="text-[10px] font-medium text-ink">Reduced motion</p>
                  <p className="text-[9px] text-muted">Minimise animations and transitions.</p>
                </div>
                <Toggle checked={reducedMotion} onChange={setReducedMotion} label="Toggle reduced motion" />
              </div>
            </section>

            <section className="card p-4">
              <h2 className="text-[13px] font-semibold text-ink">Session</h2>
              <div className="mt-2 space-y-1.5 text-[10px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted">Signed in as</span>
                  <span className="font-medium text-ink">{user?.email}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Last login</span>
                  <span className="text-ink">{user?.last_login_at ? timeAgo(user.last_login_at) : "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Token storage</span>
                  <span className="text-ink">Browser local storage</span>
                </div>
              </div>
              <p className="mt-2 text-[9px] leading-relaxed text-muted/65">
                JWT bearer sessions expire automatically. Signing out revokes the current token server-side.
              </p>
            </section>
          </div>
        </div>
      )}

      {tab === "system" && (
        <div className="grid gap-3 xl:grid-cols-12">
          <section className="card p-4 xl:col-span-7">
            <div className="mb-3 flex items-center gap-2">
              <Database className="h-4 w-4 text-accent" />
              <h2 className="text-[13px] font-semibold text-ink">Runtime & deployment</h2>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { label: "Application", value: system.app },
                { label: "API version", value: system.version },
                { label: "Environment", value: system.environment },
                { label: "Database backend", value: system.database_backend },
                { label: "Background workers", value: system.background_workers ? "Running" : "Disabled" },
                { label: "Local collector", value: system.local_collector_enabled ? "Enabled" : "Disabled" },
                { label: "Agent enrollment", value: system.agent_enrollment_enabled ? "Configured" : "Disabled" },
                { label: "Avg API latency", value: `${system.api_latency_ms.toFixed(1)} ms` },
              ].map((row) => (
                <div key={row.label} className="rounded-lg border border-line/10 bg-canvas/25 px-3 py-2">
                  <p className="text-[9px] uppercase tracking-[0.1em] text-muted/60">{row.label}</p>
                  <p className="mt-0.5 font-mono text-[10px] font-medium text-ink">{row.value}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 rounded-lg border border-line/10 bg-canvas/25 px-3 py-2 text-[9px] leading-relaxed text-muted">
              <span className="font-semibold text-ink">Deployment honesty.</span> Production configuration files for
              Render, Vercel and MongoDB Atlas are included in the repository, but this instance is running locally in
              the {system.environment} environment. No public deployment is claimed. {system.database_detail}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<ExternalLink className="h-3.5 w-3.5" />}
                onClick={() => window.open(`${API_BASE}/docs`, "_blank", "noopener,noreferrer")}
              >
                Open API docs
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                onClick={() => {
                  void refresh();
                  toast.info("Runtime status refreshed");
                }}
              >
                Refresh status
              </Button>
            </div>
          </section>

          <aside className="space-y-3 xl:col-span-5">
            <section className="card p-4">
              <div className="mb-2 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-positive" />
                <h2 className="text-[13px] font-semibold text-ink">Security posture</h2>
              </div>
              <div className="space-y-2">
                {[
                  "JWT bearer tokens with revocation list",
                  "scrypt password hashing",
                  "Admin / viewer role enforcement",
                  "CORS allow-list from environment",
                  "Security headers and no-store API responses",
                  "Agent keys stored as one-way hashes",
                ].map((item) => (
                  <p key={item} className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted">
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-positive" /> {item}
                  </p>
                ))}
              </div>
            </section>

            <section className="card border-warning/20 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div>
                  <h2 className="text-[12px] font-semibold text-ink">Production checklist</h2>
                  <p className="mt-1 text-[9px] leading-relaxed text-muted">
                    Set SECRET_KEY, MONGO_URI, ALLOWED_ORIGINS and AGENT_ENROLLMENT_TOKEN. Run one Gunicorn worker
                    because background threads and Socket.IO are process-local. Enable TLS at the platform edge.
                  </p>
                </div>
              </div>
            </section>

            {isAdmin && (
              <section className="card p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-[12px] font-semibold text-ink">Quick actions</h2>
                  <ServerIcon className="h-3.5 w-3.5 text-muted" />
                </div>
                <div className="grid gap-1.5">
                  <Button variant="secondary" size="sm" className="justify-start" icon={<Laptop className="h-3.5 w-3.5" />} onClick={() => window.location.assign("/infrastructure")}>
                    Register a monitoring target
                  </Button>
                  <Button variant="secondary" size="sm" className="justify-start" icon={<BellRing className="h-3.5 w-3.5" />} onClick={() => setTab("thresholds")}>
                    Tune threshold policy
                  </Button>
                  <Button variant="secondary" size="sm" className="justify-start" icon={<Radio className="h-3.5 w-3.5" />} onClick={() => window.location.assign("/monitoring")}>
                    Open live stream
                  </Button>
                </div>
              </section>
            )}
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={modeConfirm}
        onClose={() => setModeConfirm(false)}
        onConfirm={() => void switchMode()}
        title={mode === "demo" ? "Enable live monitoring?" : "Return to demo mode?"}
        description={
          mode === "demo"
            ? "Demo targets will be hidden and the local collector will start reporting real host metrics. You can add remote agents from Infrastructure."
            : "Live targets will be hidden and the simulated demo generator will resume. Stored live telemetry remains available when you switch back."
        }
        confirmLabel={mode === "demo" ? "Enable live mode" : "Enable demo mode"}
        loading={modeLoading}
        tone={mode === "demo" ? "primary" : "danger"}
      />
    </div>
  );
}
