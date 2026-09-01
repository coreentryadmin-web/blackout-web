export type NightHawkDeskTheme = "dark" | "light";

export const NIGHTHAWK_DESK_THEME_KEY = "nighthawk-desk-theme";

export function parseNightHawkDeskTheme(value: string | null | undefined): NightHawkDeskTheme | null {
  if (value === "dark" || value === "light") return value;
  return null;
}

export function readStoredNightHawkDeskTheme(): NightHawkDeskTheme | null {
  if (typeof window === "undefined") return null;
  return parseNightHawkDeskTheme(window.localStorage.getItem(NIGHTHAWK_DESK_THEME_KEY));
}

export function systemNightHawkDeskTheme(): NightHawkDeskTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
