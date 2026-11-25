import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { apiRequest } from "../lib/api";
import { useApi } from "../hooks/useApi";
import { useSocketEvent } from "../hooks/useSocketEvent";
import type { HealthResponse, MonitoringSettings, SettingsPayload, SystemInfo } from "../types";
import { useAuth } from "./AuthContext";
import { useSocket } from "./SocketContext";

interface SystemContextValue {
  settings: MonitoringSettings | null;
  system: SystemInfo | null;
  health: HealthResponse | null;
  mode: "demo" | "live";
  isDemo: boolean;
  loading: boolean;
  error: string | null;
  socketStatus: "connected" | "connecting" | "disconnected";
  apiOnline: boolean;
  refresh: () => Promise<void>;
  updateMode: (mode: "demo" | "live") => Promise<string>;
  saveSettings: (payload: Partial<MonitoringSettings>) => Promise<string>;
}

const SystemContext = createContext<SystemContextValue | null>(null);

export function SystemProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const { status: socketStatus } = useSocket();
  const settingsApi = useApi<SettingsPayload>("/settings", {
    enabled: Boolean(token),
    refreshInterval: 60_000,
  });
  const healthApi = useApi<HealthResponse>("/health", { refreshInterval: 30_000 });

  const refresh = useCallback(async () => {
    await Promise.all([settingsApi.refreshSilently(), healthApi.refreshSilently()]);
  }, [settingsApi.refreshSilently, healthApi.refreshSilently]);

  useSocketEvent("mode:changed", () => {
    void refresh();
  });
  useSocketEvent("settings:updated", () => {
    void refresh();
  });

  const applyPayload = useCallback(
    (payload: SettingsPayload & { message?: string }) => {
      settingsApi.setData(payload);
      void healthApi.refreshSilently();
      return payload.message || "Monitoring configuration saved.";
    },
    [settingsApi.setData, healthApi.refreshSilently],
  );

  const updateMode = useCallback(
    async (mode: "demo" | "live") => {
      const payload = await apiRequest<SettingsPayload & { message?: string }>("/settings", {
        method: "PUT",
        body: { mode },
      });
      return applyPayload(payload);
    },
    [applyPayload],
  );

  const saveSettings = useCallback(
    async (patch: Partial<MonitoringSettings>) => {
      const payload = await apiRequest<SettingsPayload & { message?: string }>("/settings", {
        method: "PUT",
        body: patch,
      });
      return applyPayload(payload);
    },
    [applyPayload],
  );

  const mode = settingsApi.data?.settings.mode || "demo";
  const value = useMemo<SystemContextValue>(
    () => ({
      settings: settingsApi.data?.settings || null,
      system: settingsApi.data?.system || null,
      health: healthApi.data || null,
      mode,
      isDemo: mode === "demo",
      loading: settingsApi.loading || healthApi.loading,
      error: settingsApi.error || healthApi.error,
      socketStatus,
      apiOnline: healthApi.data?.status === "ok",
      refresh,
      updateMode,
      saveSettings,
    }),
    [
      settingsApi.data,
      settingsApi.loading,
      settingsApi.error,
      healthApi.data,
      healthApi.loading,
      healthApi.error,
      mode,
      socketStatus,
      refresh,
      updateMode,
      saveSettings,
    ],
  );

  return <SystemContext.Provider value={value}>{children}</SystemContext.Provider>;
}

export function useSystem() {
  const context = useContext(SystemContext);
  if (!context) throw new Error("useSystem must be used inside SystemProvider");
  return context;
}
