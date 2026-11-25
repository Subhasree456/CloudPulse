export const TOKEN_KEY = "cloudpulse_token";
export const USER_KEY = "cloudpulse_user";

function normalizeBase(value: string): string {
  const trimmed = value.replace(/\/+$/, "");
  return trimmed.endsWith("/api") || trimmed === "/api" ? trimmed : `${trimmed}/api`;
}

export const API_BASE = normalizeBase(import.meta.env.VITE_API_URL || "/api");

export const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (API_BASE.startsWith("http") ? API_BASE.replace(/\/api$/, "") : window.location.origin);

export class ApiError extends Error {
  status: number;
  code?: string;
  field?: string;

  constructor(message: string, status: number, code?: string, field?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);

function dispatchUnauthorized() {
  window.dispatchEvent(new CustomEvent("cloudpulse:unauthorized"));
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  auth?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal, auth = true } = options;
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
    credentials: "omit",
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    const error = (payload as { error?: { message?: string; code?: string; field?: string } })?.error;
    const message =
      error?.message ||
      (typeof payload === "string" && payload) ||
      `Request failed with status ${response.status}.`;
    if (response.status === 401 && token && !path.startsWith("/auth/login") && !path.startsWith("/auth/register")) {
      dispatchUnauthorized();
    }
    throw new ApiError(message, response.status, error?.code, error?.field);
  }

  return payload as T;
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded?.[1]) return decodeURIComponent(encoded[1]);
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] || fallback;
}

export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const token = getToken();
  const response = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: "omit",
  });
  if (!response.ok) {
    let message = `Download failed with status ${response.status}.`;
    try {
      const body = await response.json();
      message = body?.error?.message || message;
    } catch {
      // Keep the generic message.
    }
    if (response.status === 401) dispatchUnauthorized();
    throw new ApiError(message, response.status);
  }
  const blob = await response.blob();
  const filename = filenameFromDisposition(response.headers.get("content-disposition"), fallbackName);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
