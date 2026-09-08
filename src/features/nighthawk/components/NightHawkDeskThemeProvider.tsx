"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  NIGHTHAWK_DESK_THEME_KEY,
  readStoredNightHawkDeskTheme,
  systemNightHawkDeskTheme,
  type NightHawkDeskTheme,
} from "@/features/nighthawk/lib/nighthawk-desk-theme";

type NightHawkDeskThemeContextValue = {
  theme: NightHawkDeskTheme;
  setTheme: (theme: NightHawkDeskTheme) => void;
  toggleTheme: () => void;
};

const NightHawkDeskThemeContext = createContext<NightHawkDeskThemeContextValue | null>(null);

function applyDeskTheme(theme: NightHawkDeskTheme) {
  const root = document.querySelector(".nh-v2-page");
  if (root) root.setAttribute("data-desk-theme", theme);
  document.documentElement.setAttribute("data-nighthawk-desk-theme", theme);
  document.documentElement.style.colorScheme = theme;
}

/** Persists Night Hawk desk theme (X Ads Manager light/dark analogue) on `.nh-v2-page`. */
export function NightHawkDeskThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<NightHawkDeskTheme>("dark");

  useEffect(() => {
    const stored = readStoredNightHawkDeskTheme();
    const initial = stored ?? systemNightHawkDeskTheme();
    setThemeState(initial);
    applyDeskTheme(initial);
  }, []);

  const setTheme = useCallback((next: NightHawkDeskTheme) => {
    setThemeState(next);
    window.localStorage.setItem(NIGHTHAWK_DESK_THEME_KEY, next);
    applyDeskTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((cur) => {
      const next = cur === "dark" ? "light" : "dark";
      window.localStorage.setItem(NIGHTHAWK_DESK_THEME_KEY, next);
      applyDeskTheme(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme]
  );

  return <NightHawkDeskThemeContext.Provider value={value}>{children}</NightHawkDeskThemeContext.Provider>;
}

export function useNightHawkDeskTheme(): NightHawkDeskThemeContextValue {
  const ctx = useContext(NightHawkDeskThemeContext);
  if (!ctx) {
    throw new Error("useNightHawkDeskTheme must be used within NightHawkDeskThemeProvider");
  }
  return ctx;
}
