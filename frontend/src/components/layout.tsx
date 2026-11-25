import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BrainCircuit,
  ChevronDown,
  Cloud,
  FileText,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  Radio,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useSystem } from "../context/SystemContext";
import { useSocket } from "../context/SocketContext";
import { useToast } from "../context/ToastContext";
import { useApi } from "../hooks/useApi";
import { useSocketEvent } from "../hooks/useSocketEvent";
import { cn, initials, timeAgo } from "../lib/format";
import { Logo, LogoMark } from "./Logo";
import { Button, ConfirmDialog, IconButton, ModeBadge, StatusBadge } from "./ui";
import type { AlertSummary } from "../types";

interface NavEntry {
  to: string;
  label: string;
  icon: typeof Activity;
  end?: boolean;
  adminOnly?: boolean;
}

const NAV_GROUPS: { label: string; items: NavEntry[] }[] = [
  {
    label: "Monitor",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
      { to: "/infrastructure", label: "Infrastructure", icon: Server },
      { to: "/monitoring", label: "Live Monitoring", icon: Radio },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { to: "/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/alerts", label: "Alerts", icon: AlertTriangle },
      { to: "/anomalies", label: "Anomaly Detection", icon: BrainCircuit },
      { to: "/reports", label: "Reports", icon: FileText },
    ],
  },
  {
    label: "Platform",
    items: [
      { to: "/services", label: "Cloud Services", icon: Cloud },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

const PAGE_META: Record<string, { title: string; description: string }> = {
  "/": { title: "Operations Overview", description: "Fleet health at a glance" },
  "/infrastructure": { title: "Infrastructure", description: "Registered monitoring targets" },
  "/monitoring": { title: "Live Monitoring", description: "Streaming telemetry" },
  "/analytics": { title: "Analytics", description: "Capacity and cost intelligence" },
  "/alerts": { title: "Alerts", description: "Threshold incidents and lifecycle" },
  "/anomalies": { title: "Anomaly Detection", description: "Isolation Forest insights" },
  "/reports": { title: "Reports", description: "Operational summaries and exports" },
  "/services": { title: "Cloud Services", description: "Integration inventory and honesty map" },
  "/settings": { title: "Settings", description: "Monitoring, thresholds and account" },
};

function useLiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function Sidebar({
  open,
  onClose,
  alertCount,
}: {
  open: boolean;
  onClose: () => void;
  alertCount: number;
}) {
  const { user, isAdmin, logout } = useAuth();
  const { mode } = useSystem();
  const navigate = useNavigate();

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/65 backdrop-blur-sm transition lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[244px] flex-col border-r border-line/12 bg-canvas/80 backdrop-blur-2xl transition-transform duration-300 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        aria-label="Main navigation"
      >
        <div className="flex h-[68px] items-center justify-between px-4">
          <Logo />
          <IconButton label="Close navigation" onClick={onClose} className="lg:hidden">
            <X className="h-4 w-4" />
          </IconButton>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4 pt-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-1.5 px-3 text-[9px] font-semibold uppercase tracking-[0.2em] text-muted/55">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items
                  .filter((item) => !item.adminOnly || isAdmin)
                  .map((item) => {
                    const Icon = item.icon;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        onClick={onClose}
                        className={({ isActive }) => cn("nav-item", isActive && "text-ink")}
                      >
                        {({ isActive }) => (
                          <>
                            <span data-active={isActive} className="contents">
                              <span
                                className="absolute inset-0 rounded-xl"
                                style={
                                  isActive
                                    ? {
                                        background:
                                          "linear-gradient(90deg, rgb(var(--accent-rgb) / 0.13), rgb(var(--accent-rgb) / 0.03))",
                                      }
                                    : undefined
                                }
                                aria-hidden="true"
                              />
                              <Icon className={cn("relative h-4 w-4", isActive ? "text-accent" : "text-muted")} />
                              <span className="relative flex-1">{item.label}</span>
                              {item.to === "/alerts" && alertCount > 0 && (
                                <span className="relative rounded-md border border-danger/25 bg-danger/10 px-1.5 py-0.5 text-[9px] font-bold text-danger">
                                  {alertCount > 99 ? "99+" : alertCount}
                                </span>
                              )}
                            </span>
                            {isActive && (
                              <span className="absolute -left-3 top-2.5 bottom-2.5 w-[2px] rounded-full bg-accent shadow-[0_0_12px_rgba(34,211,238,0.6)]" />
                            )}
                          </>
                        )}
                      </NavLink>
                    );
                  })}
              </div>
            </div>
          ))}
        </nav>

        <div className="space-y-2 border-t border-line/10 p-3">
          <div className="rounded-xl border border-line/12 bg-canvas/40 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted/60">Data mode</span>
              <ModeBadge mode={mode} compact />
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-muted/75">
              {mode === "demo"
                ? "Simulated telemetry is clearly labelled across every view."
                : "Measurements come from live agents and the local collector."}
            </p>
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate("/settings");
              }}
              className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-accent transition hover:brightness-110"
            >
              Configure monitoring <ChevronDown className="h-3 w-3 -rotate-90" />
            </button>
          </div>

          <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-accent/25 bg-accent/10 text-[10px] font-semibold text-accent">
              {initials(user?.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold text-ink">{user?.name}</p>
              <p className="truncate text-[9px] uppercase tracking-[0.1em] text-muted/70">
                {user?.role === "admin" ? "Administrator" : "Viewer"}
              </p>
            </div>
            <IconButton
              label="Sign out"
              className="h-8 w-8"
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              <LogOut className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        </div>
      </aside>
    </>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const { user, isAdmin, logout } = useAuth();
  const { mode, socketStatus, updateMode } = useSystem();
  const { status } = useSocket();
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);
  const [modeDialog, setModeDialog] = useState(false);
  const [switching, setSwitching] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const clock = useLiveClock();
  const meta = PAGE_META[location.pathname] || PAGE_META["/"];
  const alertsApi = useApi<{ summary: AlertSummary }>("/alerts/summary/current", {
    refreshInterval: 30_000,
  });
  const activeAlerts = alertsApi.data?.summary.active ?? 0;

  useSocketEvent("alert:new", () => void alertsApi.refreshSilently());
  useSocketEvent("alert:updated", () => void alertsApi.refreshSilently());

  useEffect(() => {
    if (!profileOpen) return;
    const handler = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [profileOpen]);

  const statusLabel = useMemo(() => {
    if (socketStatus === "connected") return "Socket connected";
    if (socketStatus === "connecting") return "Connecting…";
    return "Real-time offline";
  }, [socketStatus]);

  const switchMode = async () => {
    const target = mode === "demo" ? "live" : "demo";
    setSwitching(true);
    try {
      const message = await updateMode(target);
      toast.success(target === "demo" ? "Demo mode enabled" : "Live mode enabled", message);
      setModeDialog(false);
    } catch (error) {
      toast.error("Unable to change mode", error instanceof Error ? error.message : undefined);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-line/10 bg-canvas/70 backdrop-blur-xl">
      <div className="flex h-[68px] items-center gap-3 px-3 sm:px-5 lg:px-7">
        <IconButton label="Open navigation" onClick={onMenu} className="lg:hidden">
          <Menu className="h-4 w-4" />
        </IconButton>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold tracking-[-0.02em] text-ink">{meta.title}</h1>
            <span className="hidden rounded-md border border-line/15 bg-line/5 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] text-muted sm:inline">
              v1.0
            </span>
          </div>
          <p className="mt-0.5 hidden truncate text-[10px] text-muted sm:block">{meta.description}</p>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[9px] font-semibold",
              status === "connected"
                ? "border-positive/20 bg-positive/8 text-positive"
                : status === "connecting"
                  ? "border-warning/20 bg-warning/8 text-warning"
                  : "border-line/20 bg-line/5 text-muted",
            )}
            title={statusLabel}
          >
            {status === "connected" ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            <span className="hidden lg:inline">{statusLabel}</span>
            <span className="lg:hidden">{status === "connected" ? "Online" : "Offline"}</span>
          </span>

          <button
            type="button"
            onClick={() => isAdmin && setModeDialog(true)}
            disabled={!isAdmin}
            title={isAdmin ? "Switch monitoring data mode" : "Only administrators can change the mode"}
            className={cn("transition", isAdmin && "hover:brightness-110")}
          >
            <span
              className={cn(
                "chip",
                mode === "demo"
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : "border-positive/30 bg-positive/10 text-positive",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", mode === "demo" ? "bg-warning" : "bg-positive")} />
              {mode === "demo" ? "Demo data" : "Live data"}
            </span>
          </button>
        </div>

        <div className="hidden text-right xl:block">
          <p className="font-mono text-[11px] font-medium text-ink">
            {clock.toLocaleTimeString("en-GB", { hour12: false })}
          </p>
          <p className="text-[9px] text-muted/70">
            {clock.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
          </p>
        </div>

        <div className="mx-1 hidden h-7 w-px bg-line/15 md:block" />

        <button
          type="button"
          onClick={() => navigate("/alerts")}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted transition hover:bg-panel/70 hover:text-ink"
          aria-label={`${activeAlerts} active alerts`}
        >
          <Bell className="h-4 w-4" />
          {activeAlerts > 0 && (
            <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full border border-canvas bg-danger px-1 text-[8px] font-bold text-white">
              {activeAlerts > 9 ? "9+" : activeAlerts}
            </span>
          )}
        </button>

        <div className="relative" ref={profileRef}>
          <button
            type="button"
            onClick={() => setProfileOpen((value) => !value)}
            className="flex items-center gap-2 rounded-xl border border-transparent p-1 transition hover:border-line/15 hover:bg-panel/50"
            aria-label="Open account menu"
            aria-expanded={profileOpen}
          >
            <span className="grid h-8 w-8 place-items-center rounded-full border border-accent/25 bg-gradient-to-br from-accent/20 to-info/10 text-[10px] font-semibold text-accent">
              {initials(user?.name)}
            </span>
            <ChevronDown className={cn("hidden h-3.5 w-3.5 text-muted transition sm:block", profileOpen && "rotate-180")} />
          </button>

          {profileOpen && (
            <div className="absolute right-0 top-12 w-56 animate-fade-up overflow-hidden rounded-xl border border-line/15 bg-panel/95 shadow-card backdrop-blur-2xl">
              <div className="border-b border-line/10 px-3.5 py-3">
                <p className="truncate text-xs font-semibold text-ink">{user?.name}</p>
                <p className="truncate text-[10px] text-muted">{user?.email}</p>
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="chip border-accent/20 bg-accent/8 text-accent">
                    <ShieldCheck className="h-2.5 w-2.5" />
                    {user?.role === "admin" ? "Administrator" : "Viewer"}
                  </span>
                  <StatusBadge status={socketStatus === "connected" ? "healthy" : "warning"} dot={false} />
                </div>
              </div>
              <div className="p-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    navigate("/settings");
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] text-muted transition hover:bg-line/8 hover:text-ink"
                >
                  <Gauge className="h-3.5 w-3.5" /> Account & preferences
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    navigate("/services");
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] text-muted transition hover:bg-line/8 hover:text-ink"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Service status
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setProfileOpen(false);
                    await logout();
                    navigate("/login");
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[11px] text-danger transition hover:bg-danger/10"
                >
                  <LogOut className="h-3.5 w-3.5" /> Sign out
                </button>
              </div>
              <div className="border-t border-line/10 px-3.5 py-2">
                <p className="text-[9px] text-muted/60">
                  Session active · last view {timeAgo(new Date().toISOString())}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={modeDialog}
        onClose={() => setModeDialog(false)}
        onConfirm={switchMode}
        title={mode === "demo" ? "Switch to live monitoring?" : "Return to demo mode?"}
        description={
          mode === "demo"
            ? "Live mode hides simulated targets and starts a local psutil collector for this host. You can also enroll remote agents from Infrastructure. Demo history is retained and returns when you switch back."
            : "Demo mode hides live targets and resumes clearly-labelled simulated telemetry across all views. Live targets and their stored history are kept."
        }
        confirmLabel={mode === "demo" ? "Enable live mode" : "Enable demo mode"}
        loading={switching}
        tone={mode === "demo" ? "primary" : "danger"}
      />
    </header>
  );
}

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const alertsApi = useApi<{ summary: AlertSummary }>("/alerts/summary/current", { refreshInterval: 45_000 });
  useSocketEvent("alert:new", () => void alertsApi.refreshSilently());
  useSocketEvent("alert:updated", () => void alertsApi.refreshSilently());

  useEffect(() => {
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [location.pathname]);

  return (
    <div className="min-h-screen lg:pl-[244px]">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} alertCount={alertsApi.data?.summary.active ?? 0} />
      <Topbar onMenu={() => setSidebarOpen(true)} />
      <main className="mx-auto w-full max-w-[1560px] px-3 py-4 sm:px-5 sm:py-5 lg:px-7 lg:py-6">
        <Outlet />
      </main>
      <footer className="mx-auto flex w-full max-w-[1560px] flex-wrap items-center justify-between gap-2 px-4 pb-5 text-[9px] text-muted/55 sm:px-6 lg:px-7">
        <span className="flex items-center gap-1.5">
          <LogoMark size={16} /> CloudPulse · Monitor. Analyse. Optimise.
        </span>
        <span>Simulated data is always labelled. No cloud-provider credentials are configured.</span>
      </footer>
    </div>
  );
}

export function AuthShell({ children }: { children: ReactNode }) {
  return <div className="min-h-screen">{children}</div>;
}
