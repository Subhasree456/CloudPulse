import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemeName = "navy" | "midnight" | "slate";
export type AccentName = "cyan" | "violet" | "emerald" | "amber";

interface Preferences {
  theme: ThemeName;
  accent: AccentName;
  reducedMotion: boolean;
}

interface ThemeContextValue extends Preferences {
  setTheme: (theme: ThemeName) => void;
  setAccent: (accent: AccentName) => void;
  setReducedMotion: (value: boolean) => void;
}

const STORAGE_KEY = "cloudpulse_preferences";
const DEFAULT_PREFERENCES: Preferences = { theme: "navy", accent: "cyan", reducedMotion: false };

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readPreferences(): Preferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(stored) as Partial<Preferences>;
    return {
      theme: ["navy", "midnight", "slate"].includes(parsed.theme || "") ? (parsed.theme as ThemeName) : "navy",
      accent: ["cyan", "violet", "emerald", "amber"].includes(parsed.accent || "")
        ? (parsed.accent as AccentName)
        : "cyan",
      reducedMotion: Boolean(parsed.reducedMotion),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = preferences.theme;
    root.dataset.accent = preferences.accent;
    root.dataset.reducedMotion = String(preferences.reducedMotion);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    const themeColor = getComputedStyle(root).getPropertyValue("--canvas-rgb").trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && themeColor) {
      const [r, g, b] = themeColor.split(/\s+/).map(Number);
      meta.setAttribute("content", `rgb(${r}, ${g}, ${b})`);
    }
  }, [preferences]);

  const setTheme = useCallback((theme: ThemeName) => setPreferences((current) => ({ ...current, theme })), []);
  const setAccent = useCallback((accent: AccentName) => setPreferences((current) => ({ ...current, accent })), []);
  const setReducedMotion = useCallback(
    (reducedMotion: boolean) => setPreferences((current) => ({ ...current, reducedMotion })),
    [],
  );

  const value = useMemo(
    () => ({ ...preferences, setTheme, setAccent, setReducedMotion }),
    [preferences, setTheme, setAccent, setReducedMotion],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
