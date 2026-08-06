/**
 * Night Hawk VIEW selection — the single-select toggle model (0DTE / Swings / Bangers / Legacy).
 *
 * The remodel turns Night Hawk into ONE surface with a four-way toggle; selecting a view scopes the ENTIRE
 * page to it. Two views map to a horizon lane (the whole-market 0DTE/Swing boards); "Bangers" renders
 * Engine B — the whole-market weekly-banger discovery + live scale-out board (BangerBoard) — which is NOT
 * part of the horizon-ledger system, so its meta entry carries `horizon: null` like Legacy; "Legacy" is the
 * original evening "Tonight's playbook" edition, kept as its own toggle rather than removed.
 *
 * 2026-08-04: LEAPS removed from this visible toggle (operator instruction — the LEAPS horizon lane has no
 * live signal adapter feeding it yet, so it only ever rendered an empty placeholder lane; see
 * docs/audit/FINDINGS.md). This is a NAV-LAYER-ONLY change: the underlying `Horizon` "LEAPS" id
 * (`@/lib/horizons`), `horizon-plays.ts`, `serving-lane.ts`, and the horizon-ledger DB/API plumbing are
 * deliberately untouched and still fully wired — only removed from the set a member can select here. A
 * future LEAPS revival re-adds a `LEAPS` entry to `NIGHTHAWK_VIEWS`/`NIGHTHAWK_VIEW_META` and a
 * `HorizonDeck horizon="LEAPS"` branch in NightHawkFeed; no data-layer work needed.
 *
 * PURE — parsing/labels/mapping only, so the toggle UI, the URL/query param, and the API can all agree on
 * one vocabulary. No IO, no React.
 */

import type { Horizon } from "@/lib/horizons";

export type NightHawkView = "ZERO_DTE" | "SWING" | "BANGER" | "LEGACY";

/** Toggle order, left → right: fastest horizon → slowest → Engine B → the legacy evening playbook. */
export const NIGHTHAWK_VIEWS: readonly NightHawkView[] = ["ZERO_DTE", "SWING", "BANGER", "LEGACY"] as const;

/** The default the page opens on when nothing is selected/persisted — the flagship live board. */
export const DEFAULT_NIGHTHAWK_VIEW: NightHawkView = "ZERO_DTE";

export interface NightHawkViewMeta {
  /** Toggle chip label. */
  label: string;
  /** Short mono tag. */
  tag: string;
  /** One-line descriptor for the header when this view is active. */
  blurb: string;
  /** The horizon lane this view renders, or null when the view is not part of the horizon-ledger system
   * (the legacy evening playbook, or Engine B's standalone banger board). */
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
  BANGER: {
    label: "Bangers",
    tag: "BANGER",
    blurb: "Engine B — whole-market weekly-banger discovery with live scale-out tracking.",
    horizon: null,
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
    case "BANGER":
    case "BANGERS":
    case "WEEKLY":
      return "BANGER";
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

/**
 * The view that renders a given horizon lane, or null when the horizon has no visible toggle (LEAPS —
 * the horizon-ledger id still exists in `@/lib/horizons`, but it was removed from the Night Hawk toggle
 * 2026-08-04 since no live signal adapter feeds it; see the header comment above).
 */
export function viewForHorizon(horizon: Horizon): NightHawkView | null {
  if (horizon === "ZERO_DTE" || horizon === "SWING") return horizon;
  return null; // LEAPS: horizon-ledger id survives, but has no view in this toggle right now
}

/**
 * Compact command-center header labels (`CommandDeck`'s `laneLabel` prop, rendered into
 * `.nh-deck-cmd-lane`) — a SEPARATE, shorter vocabulary from `NIGHTHAWK_VIEW_META`'s toggle-chip
 * `label`/`blurb` above. Centralized here (2026-08-06) after a live bug: `.nh-deck-cmd-lane` sits
 * inside `.nh-deck-cmd--inline`, a flex:1 1 auto + min-width:0 container that can shrink narrower
 * than its own non-wrapping child on a narrow viewport — and because the child is
 * white-space:nowrap + overflow:visible (not clipped/ellipsized), a label long enough to not fit
 * bleeds its pixels over the adjacent engine-status/Opps-Top-Edge stat pills instead of wrapping
 * or scrolling. Confirmed live on the 430px mobile Legacy tab: the old inline literal
 * "Legacy · Tonight's playbook" (~27 chars) overlapped "ENGINE Monitoring / UPDATED 11h ago" and
 * "Opps 5" — the other three lanes' labels below were all short enough (~15-17 chars) to never
 * have hit this. `MAX_COMPACT_LANE_LABEL_LEN` + the unit test in nighthawk-view.test.ts are a
 * length TRIPWIRE (not a CSS fix) — the shared compact-header CSS is unchanged, so a future label
 * edit that creeps back past the safe bound fails the test instead of shipping a silent overlap.
 */
export const NIGHTHAWK_COMPACT_LANE_LABEL = {
  ZERO_DTE: "0DTE · same-day",
  ZERO_DTE_SIM: "0DTE · SIMULATION",
  SWING: "Swings · 2–30 DTE",
  LEAPS: "LEAPS · ≤90 DTE",
  LEGACY: "Legacy · Playbook",
} as const;

/** Longest length confirmed to render without overlap in `.nh-deck-cmd--inline` at the narrowest
 *  supported (430px iPhone) viewport — see {@link NIGHTHAWK_COMPACT_LANE_LABEL}'s header comment. */
export const MAX_COMPACT_LANE_LABEL_LEN = 20;
