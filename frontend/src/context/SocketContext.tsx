import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { SOCKET_URL } from "../lib/api";
import { useAuth } from "./AuthContext";

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

interface SocketContextValue {
  socket: Socket | null;
  status: ConnectionStatus;
  error: string | null;
}

const SocketContext = createContext<SocketContextValue>({ socket: null, status: "disconnected", error: null });

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !user) {
      setSocket(null);
      setStatus("disconnected");
      return;
    }
    setStatus("connecting");
    let instance: Socket | null = null;
    let disposed = false;

    // Deferring the handshake avoids a connect/disconnect race during
    // React StrictMode's development-only double mount. The cleanup
    // cancels the timer before the throwaway mount can open a socket.
    const connectTimer = window.setTimeout(() => {
      if (disposed) return;
      instance = io(SOCKET_URL, {
        auth: { token },
        // Werkzeug's development server does not complete the WebSocket
        // upgrade; it logs a harmless 500 for each attempt. Polling still
        // streams the same Socket.IO events, so use it for local previews.
        // Production (Gunicorn) keeps WebSocket with polling fallback.
        transports: import.meta.env.DEV ? ["polling"] : ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 1200,
        reconnectionDelayMax: 6000,
        timeout: 12000,
      });
      setSocket(instance);

      instance.on("connect", () => {
        setStatus("connected");
        setError(null);
      });
      instance.on("disconnect", () => setStatus("disconnected"));
      instance.on("connect_error", (caught: Error) => {
        setStatus("disconnected");
        setError(caught.message || "Real-time connection unavailable.");
      });
      instance.io.on("reconnect_attempt", () => setStatus("connecting"));
    }, 200);

    return () => {
      disposed = true;
      window.clearTimeout(connectTimer);
      if (instance) {
        instance.removeAllListeners();
        instance.disconnect();
      }
    };
  }, [token, user?.id]);

  const value = useMemo(() => ({ socket, status, error }), [socket, status, error]);
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}
