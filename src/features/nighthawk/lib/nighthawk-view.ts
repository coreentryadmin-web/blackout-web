/**
 * Night Hawk VIEW selection — the single-select toggle model (0DTE / Swings / LEAPS / Legacy).
 *
 * The remodel turns Night Hawk into ONE surface with a four-way toggle; selecting a view scopes the ENTIRE
 * page to it. Three views map to a horizon lane (the new whole-market 0DTE/Swing/LEAPS boards); "Legacy" is
 * the original evening "Tonight's playbook" edition, kept as its own toggle rather than removed.
 *
 * PURE — parsing/labels/mapping only, so the toggle UI, the URL/query param, and the API can all agree on
 * one vocabulary. No IO, no React.
 */

import type { Horizon } from "@/lib/horizons";

export type NightHawkView = "ZERO_DTE" | "SWING" | "LEAPS" | "LEGACY";

/** Toggle order, left → right: fastest horizon → slowest → the legacy evening playbook. */
export const NIGHTHAWK_VIEWS: readonly NightHawkView[] = ["ZERO_DTE", "SWING", "LEAPS", "LEGACY"] as const;

/** The default the page opens on when nothing is selected/persisted — the flagship live board. */
export const DEFAULT_NIGHTHAWK_VIEW: NightHawkView = "ZERO_DTE";

export interface NightHawkViewMeta {
  /** Toggle chip label. */
  label: string;
  /** Short mono tag. */
  tag: string;
  /** One-line descriptor for the header when this view is active. */
  blurb: string;
  /** The horizon lane this view renders, or null for the legacy evening playbook. */
  horizon: Horizon | null;
}

export const NIGHTHAWK_VIEW_META: Record<NightHawkView, NightHawkViewMeta> = {
  ZERO_DTE: {
    label: "0DTE",
    tag: "0DTE",
    blurb: "Same-day expiries across the whole market — hot flow, minutes-to-hours.",
    horizon: "ZERO_DTE",
  },
  SWING: {
    label: "Swings",
    tag: "SWING",
    blurb: "2–30 day setups building across sessions — momentum + accumulation.",
    horizon: "SWING",
  },
  LEAPS: {
    label: "LEAPS",
    tag: "LEAPS",
    blurb: "Durable theses out to 90 days — trend structure you can hold weeks.",
    horizon: "LEAPS",
  },
  LEGACY: {
    label: "Legacy",
    tag: "LEGACY",
    blurb: "Tonight's playbook — the original evening edition, ranked for next session.",
    horizon: null,
  },
};

/** Whether a string is one of the four views. */
export function isNightHawkView(raw: unknown): raw is NightHawkView {
  return typeof raw === "string" && (NIGHTHAWK_VIEWS as readonly string[]).includes(raw);
}

/**
 * Parse a view from a URL/query value, case-insensitively and tolerant of a few aliases (so a shared link
 * or a hand-typed param resolves), falling back to the default rather than erroring.
 */
export function parseNightHawkView(raw: unknown): NightHawkView {
  if (raw == null) return DEFAULT_NIGHTHAWK_VIEW;
  const s = String(raw).trim().toUpperCase().replace(/[\s-]+/g, "_");
  switch (s) {
    case "ZERO_DTE":
    case "0DTE":
    case "ZERODTE":
      return "ZERO_DTE";
    case "SWING":
    case "SWINGS":
      return "SWING";
    case "LEAPS":
    case "LEAP":
      return "LEAPS";
    case "LEGACY":
    case "PLAYBOOK":
    case "TONIGHT":
      return "LEGACY";
    default:
      return DEFAULT_NIGHTHAWK_VIEW;
  }
}

/** The horizon lane a view renders, or null for the legacy playbook. */
export function horizonForView(view: NightHawkView): Horizon | null {
  return NIGHTHAWK_VIEW_META[view].horizon;
}

/** The view that renders a given horizon lane. */
export function viewForHorizon(horizon: Horizon): NightHawkView {
  return horizon; // the three horizon ids ARE their view ids (LEGACY has no horizon)
}
