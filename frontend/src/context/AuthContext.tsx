import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiRequest, TOKEN_KEY, USER_KEY } from "../lib/api";
import type { AuthResponse, User } from "../types";

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (name: string, email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  acceptSession: (token: string, user: User) => void;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function storedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<User | null>(storedUser);
  const [loading, setLoading] = useState(Boolean(localStorage.getItem(TOKEN_KEY)));
  const checking = useRef(false);

  const persist = useCallback((nextToken: string | null, nextUser: User | null) => {
    if (nextToken) localStorage.setItem(TOKEN_KEY, nextToken);
    else localStorage.removeItem(TOKEN_KEY);
    if (nextUser) localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    else localStorage.removeItem(USER_KEY);
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  const clear = useCallback(() => persist(null, null), [persist]);

  const refreshUser = useCallback(async () => {
    if (!localStorage.getItem(TOKEN_KEY) || checking.current) return;
    checking.current = true;
    try {
      const response = await apiRequest<{ user: User }>("/auth/me");
      persist(localStorage.getItem(TOKEN_KEY), response.user);
    } catch {
      clear();
    } finally {
      checking.current = false;
      setLoading(false);
    }
  }, [clear, persist]);

  useEffect(() => {
    if (token) void refreshUser();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => clear();
    window.addEventListener("cloudpulse:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("cloudpulse:unauthorized", handleUnauthorized);
  }, [clear]);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await apiRequest<AuthResponse>("/auth/login", {
        method: "POST",
        body: { email, password },
        auth: false,
      });
      persist(response.token, response.user);
      return response.user;
    },
    [persist],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const response = await apiRequest<AuthResponse>("/auth/register", {
        method: "POST",
        body: { name, email, password },
        auth: false,
      });
      persist(response.token, response.user);
      return response.user;
    },
    [persist],
  );

  const logout = useCallback(async () => {
    try {
      await apiRequest("/auth/logout", { method: "POST" });
    } catch {
      // Local cleanup still happens if the API is unreachable.
    }
    clear();
  }, [clear]);

  const acceptSession = useCallback(
    (nextToken: string, nextUser: User) => {
      persist(nextToken, nextUser);
    },
    [persist],
  );

  const updateUser = useCallback(
    (nextUser: User) => {
      if (token) persist(token, nextUser);
    },
    [persist, token],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      loading,
      isAdmin: user?.role === "admin",
      login,
      register,
      logout,
      refreshUser,
      acceptSession,
      updateUser,
    }),
    [user, token, loading, login, register, logout, refreshUser, acceptSession, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
