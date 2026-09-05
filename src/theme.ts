import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "revzenta_theme";

export function getStoredTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* localStorage unavailable */
  }
  return "dark";
}

export function applyTheme(theme: Theme): void {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* localStorage unavailable */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("crm:theme-change", { detail: theme }));
  }
}

export function useTheme(): [Theme, (theme: Theme) => void, () => void] {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document !== "undefined") {
      const attr = document.documentElement.getAttribute("data-theme") as Theme;
      if (attr === "light" || attr === "dark") return attr;
    }
    return getStoredTheme();
  });

  useEffect(() => {
    applyTheme(theme);
    const handler = (e: Event) => {
      const custom = e as CustomEvent<Theme>;
      if (custom.detail && (custom.detail === "light" || custom.detail === "dark")) {
        setThemeState(custom.detail);
      }
    };
    window.addEventListener("crm:theme-change", handler);
    return () => window.removeEventListener("crm:theme-change", handler);
  }, [theme]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    applyTheme(t);
  };

  const toggle = () => {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
  };

  return [theme, setTheme, toggle];
}
