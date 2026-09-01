"use client";

import { useNightHawkDeskTheme } from "@/features/nighthawk/components/NightHawkDeskThemeProvider";

/** Moon/sun toggle — same affordance as X Ads Manager sidebar theme control. */
export function NightHawkDeskThemeToggle() {
  const { theme, toggleTheme } = useNightHawkDeskTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      className="nh-desk-theme-toggle"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
    >
      <span className="nh-desk-theme-toggle-icon" aria-hidden>
        {isDark ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5Z"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="4.25" stroke="currentColor" strokeWidth="1.75" />
            <path
              d="M12 2.5v2.25M12 19.25V21.5M4.22 4.22l1.59 1.59M18.19 18.19l1.59 1.59M2.5 12h2.25M19.25 12H21.5M4.22 19.78l1.59-1.59M18.19 5.81l1.59-1.59"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>
      <span className="nh-desk-theme-toggle-label">{isDark ? "Light" : "Dark"}</span>
    </button>
  );
}
