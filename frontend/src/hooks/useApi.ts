import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../lib/api";

interface UseApiOptions {
  enabled?: boolean;
  refreshInterval?: number;
}

export function useApi<T>(path: string | null, options: UseApiOptions = {}) {
  const { enabled = true, refreshInterval } = options;
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(Boolean(path) && enabled);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!path || !enabled) return;
      const id = ++requestId.current;
      controller.current?.abort();
      const localController = new AbortController();
      controller.current = localController;
      if (!silent) setLoading(true);
      try {
        const payload = await apiRequest<T>(path, { signal: localController.signal });
        if (id !== requestId.current) return;
        setData(payload);
        setError(null);
        setLastUpdated(new Date());
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        if (id !== requestId.current) return;
        setError(caught instanceof Error ? caught.message : "Unable to load data.");
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [path, enabled],
  );

  useEffect(() => {
    if (!path || !enabled) {
      setLoading(false);
      return;
    }
    void load(false);
    if (!refreshInterval) {
      return () => controller.current?.abort();
    }
    const interval = window.setInterval(() => {
      if (!document.hidden) void load(true);
    }, refreshInterval);
    return () => {
      window.clearInterval(interval);
      controller.current?.abort();
    };
  }, [path, enabled, refreshInterval, load]);

  const refresh = useCallback(() => load(false), [load]);
  const refreshSilently = useCallback(() => load(true), [load]);

  return { data, loading, error, refresh, refreshSilently, lastUpdated, setData };
}
