import type { DeckStatus, TerminalPlay } from "./types";
import { isoToEtClock, parseCommittedAtEt } from "@/lib/zerodte/play-timeline";
import { trimScaleBlendedPnlAtStop } from "@/lib/zerodte/marks-math";
import { PLAN_RULES } from "@/lib/zerodte/plan";

/** Which lifecycle bucket drives the left-rail card layout. */
export type PlayLifecyclePhase = "open" | "watch" | "closed";

export type FreshnessTier = "just_fired" | "fresh" | "aging" | "late" | "closed";

/** Green pulse — trade fired within the last ~3 minutes. */
export const FRESHNESS_JUST_FIRED_MS = 3 * 60_000;
/** Still green — under ~15 minutes since the primary event. */
export const FRESHNESS_FRESH_MS = 15 * 60_000;
/** Amber — 15–30 minutes; no pulse. */
export const FRESHNESS_AGING_MS = 30 * 60_000;

export type FreshnessThresholds = {
  justFiredMs: number;
  freshMs: number;
  agingMs: number;
};

/** Horizon-specific urgency windows — swings/legacy use longer horizons than 0DTE. */
export function freshnessThresholdsForHorizon(
  horizon: TerminalPlay["horizon"],
): FreshnessThresholds {
  switch (horizon) {
    case "SWING":
    case "LEAPS":
      return {
        justFiredMs: 60 * 60_000,
        freshMs: 6 * 60 * 60_000,
        agingMs: 24 * 60 * 60_000,
      };
    case "LEGACY":
      return {
        justFiredMs: 2 * 60 * 60_000,
        freshMs: 12 * 60 * 60_000,
        agingMs: 24 * 60 * 60_000,
      };
    default:
      return {
        justFiredMs: FRESHNESS_JUST_FIRED_MS,
        freshMs: FRESHNESS_FRESH_MS,
        agingMs: FRESHNESS_AGING_MS,
      };
  }
}

/** Short horizon badge for lifecycle cards — never names infra. */
export function horizonDisplayLabel(horizon: TerminalPlay["horizon"]): string {
  switch (horizon) {
    case "ZERO_DTE":
      return "0DTE";
    case "SWING":
      return "SWING";
    case "LEAPS":
      return "LEAPS";
    case "LEGACY":
      return "LEGACY";
  }
}

export function playLifecyclePhase(status: DeckStatus): PlayLifecyclePhase {
  if (status === "CLOSED") return "closed";
  if (status === "WATCH" || status === "SKIP") return "watch";
  return "open";
}

/** WATCH-tab rows that track hypothetical move since flag — includes gate-blocked SKIP (FAILED pill). */
export function isWatchTrackStatus(status: DeckStatus): boolean {
  return status === "WATCH" || status === "SKIP";
}

/** Human-readable relative age — "14m ago", "just now". Null when timestamp unknown. */
export function formatRelativeAge(iso: string | null | undefined, nowMs: number): string | null {
  if (!iso || !(nowMs > 0)) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const delta = nowMs - at;
  if (delta < 0) return "just now";
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return sec <= 8 ? "just now" : `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

/** Compact age for decay badges — "4m", "28m", "2h" (no "ago" suffix). */
export function formatCompactAge(iso: string | null | undefined, nowMs: number): string | null {
  if (!iso || !(nowMs > 0)) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const delta = nowMs - at;
  if (delta < 0) return "now";
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return sec <= 8 ? "now" : `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h`;
}

/** Decay tone for age badges — how actionable a 0DTE row feels by time since trigger. */
export type AgeDecayTone = "fresh" | "aging" | "stale" | "late" | "closed";

export function ageDecayToneFromAge(
  ageMs: number | null,
  phase: PlayLifecyclePhase,
  thresholds: FreshnessThresholds = {
    justFiredMs: FRESHNESS_JUST_FIRED_MS,
    freshMs: FRESHNESS_FRESH_MS,
    agingMs: FRESHNESS_AGING_MS,
  },
): AgeDecayTone {
  if (phase === "closed") return "closed";
  if (ageMs == null) return "fresh";
  if (ageMs <= thresholds.freshMs) return "fresh";
  if (ageMs <= 45 * 60_000) return "aging";
  if (ageMs <= 120 * 60_000) return "stale";
  return "late";
}

export function eventAgeMs(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso || !(nowMs > 0)) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const delta = nowMs - at;
  return delta >= 0 ? delta : 0;
}

export function freshnessTierFromAge(
  ageMs: number | null,
  phase: PlayLifecyclePhase,
  thresholds: FreshnessThresholds = {
    justFiredMs: FRESHNESS_JUST_FIRED_MS,
    freshMs: FRESHNESS_FRESH_MS,
    agingMs: FRESHNESS_AGING_MS,
  },
): FreshnessTier {
  if (phase === "closed") return "closed";
  if (ageMs == null) return "fresh";
  if (ageMs <= thresholds.justFiredMs) return "just_fired";
  if (ageMs <= thresholds.freshMs) return "fresh";
  if (ageMs <= thresholds.agingMs) return "aging";
  return "late";
}

export function freshnessBadgeLabel(tier: FreshnessTier, ageMs: number | null): string {
  switch (tier) {
    case "just_fired":
      return "JUST FIRED";
    case "fresh": {
      const min = Math.max(1, Math.floor((ageMs ?? 60_000) / 60_000));
      return `${min} MIN AGO`;
    }
    case "aging": {
      const min = Math.max(1, Math.floor((ageMs ?? 60_000) / 60_000));
      return `${min} MIN OLD`;
    }
    case "late": {
      const min = Math.max(1, Math.floor((ageMs ?? 60_000) / 60_000));
      return `${min} MIN OLD`;
    }
    case "closed":
      return "CLOSED";
  }
}

export function playPrimaryEvent(play: TerminalPlay): { label: string; iso: string | null } {
  const phase = playLifecyclePhase(play.status);
  if (phase === "closed") {
    return { label: "Closed", iso: play.exitAt ?? null };
  }
  if (phase === "watch") {
    if (play.horizon === "SWING" || play.horizon === "LEAPS") {
      return { label: "Discovered", iso: play.detectedAt ?? play.firstFlaggedAt ?? null };
    }
    if (play.horizon === "LEGACY") {
      return { label: "Published", iso: play.detectedAt ?? play.firstFlaggedAt ?? null };
    }
    return { label: "Published", iso: play.detectedAt ?? play.firstFlaggedAt ?? null };
  }
  if (play.horizon === "SWING" || play.horizon === "LEAPS") {
    return {
      label: "Entered",
      iso: play.firstFlaggedAt ?? play.committedAt ?? play.detectedAt ?? null,
    };
  }
  if (play.horizon === "LEGACY") {
    return {
      label: play.morningStatus === "CONFIRMED" ? "Confirmed" : "Active",
      iso: play.firstFlaggedAt ?? play.detectedAt ?? null,
    };
  }
  return { label: "Triggered", iso: play.firstFlaggedAt ?? null };
}

/** Secondary timestamp for closed rows — when the trade started. */
export function playTriggeredEvent(play: TerminalPlay): { label: string; iso: string | null } {
  return { label: "Triggered", iso: play.firstFlaggedAt ?? null };
}

export function playStatusLabel(status: DeckStatus): string {
  return playStatusDisplay(status).label;
}

export type StatusTone = "active" | "watch" | "closed" | "failed";

/** Scannable status pill — ACTIVE / WATCH / CLOSED / FAILED with consistent color tones. */
export function playStatusDisplay(status: DeckStatus): { label: string; tone: StatusTone } {
  if (status === "CLOSED") return { label: "CLOSED", tone: "closed" };
  if (status === "SKIP") return { label: "FAILED", tone: "failed" };
  if (status === "WATCH") return { label: "WATCH", tone: "watch" };
  return { label: "ACTIVE", tone: "active" };
}

export function setupTypeLabel(play: TerminalPlay): string | null {
  if (play.archetype) {
    return play.archetype.replace(/_/g, " ");
  }
  const o = play.discoveryOrigin?.[0];
  if (!o) return null;
  return o.replace(/_/g, " ");
}

/** Pre-entry wait line — horizon-specific, never fabricated. */
export function watchWaitLabel(play: TerminalPlay): string {
  if (play.horizon === "SWING" || play.horizon === "LEAPS") {
    if (play.servingSection === "WAITING_FOR_ENTRY" || play.entryStatus === "PRE_TRIGGER") {
      return "Waiting for Entry";
    }
    if (play.servingSection === "RESEARCH" || play.setupState === "FORMING") {
      return "Building Persistence";
    }
    return "Waiting for Entry";
  }
  if (play.horizon === "LEGACY") {
    return play.morningStatus === "DEGRADED" ? "Validate Before Entry" : "Awaiting Pre-Market Confirm";
  }
  return "Waiting for Trigger";
}

export function directionSetupLine(play: TerminalPlay): string {
  const parts: string[] = [play.direction];
  const setup = setupTypeLabel(play);
  if (setup) parts.push(setup);
  return parts.join(" • ");
}

export type PlayFreshnessDisplay = {
  tier: FreshnessTier;
  badgeLabel: string;
  pulse: boolean;
  lateEntry: boolean;
  relativeAge: string | null;
  compactAge: string | null;
  decayTone: AgeDecayTone;
};

export function playFreshnessDisplay(
  play: TerminalPlay,
  nowMs: number,
  primaryIso: string | null,
): PlayFreshnessDisplay {
  const phase = playLifecyclePhase(play.status);
  const ageMs = eventAgeMs(primaryIso, nowMs);
  const thresholds = freshnessThresholdsForHorizon(play.horizon);
  const tier = freshnessTierFromAge(ageMs, phase, thresholds);
  const decayTone = ageDecayToneFromAge(ageMs, phase, thresholds);
  const compactAge = formatCompactAge(primaryIso, nowMs);
  return {
    tier,
    badgeLabel: compactAge ?? freshnessBadgeLabel(tier, ageMs),
    pulse: tier === "just_fired" && phase === "open",
    lateEntry: tier === "late" && phase === "open",
    relativeAge: formatRelativeAge(primaryIso, nowMs),
    compactAge,
    decayTone,
  };
}

export type LifecycleTimestamp = {
  key: "detected" | "committed" | "triggered" | "closed";
  label: string;
  et: string | null;
};

/** All lifecycle clocks available on the payload — detail view only; never fabricated. */
export function playLifecycleTimestamps(play: TerminalPlay): LifecycleTimestamp[] {
  const rows: LifecycleTimestamp[] = [
    {
      key: "detected",
      label: "Detected",
      et: play.detectedAt ? isoToEtClock(play.detectedAt) : null,
    },
    {
      key: "committed",
      label: "Committed",
      et: parseCommittedAtEt(play.thesisHealth?.committedAtEt ?? null),
    },
    {
      key: "triggered",
      label: "Triggered",
      et: play.firstFlaggedAt ? isoToEtClock(play.firstFlaggedAt) : null,
    },
    {
      key: "closed",
      label: "Closed",
      et: play.exitAt ? isoToEtClock(play.exitAt) : null,
    },
  ];
  return rows.filter((r) => r.et != null);
}

/** Realized return on a closed row — exit stamp first, then trim-scale as-managed, then live P&L. */
export function closedRealizedPct(play: TerminalPlay): number | null {
  if (play.status !== "CLOSED") return null;
  if (play.exitPnlPct != null && Number.isFinite(play.exitPnlPct)) return play.exitPnlPct;
  // Server-side live_pnl_pct already carries trim-scale blend when applicable; fall back to
  // peak-derived estimate when the payload only has excursion + mechanical stop label.
  if (play.pnlPct != null && Number.isFinite(play.pnlPct) && play.closedReason !== "stopped") {
    return play.pnlPct;
  }
  if (play.closedReason === "stopped" && play.peak != null) {
    const managed = trimScaleBlendedPnlAtStop(play.peak, PLAN_RULES.stop_pct);
    if (managed != null) return managed;
  }
  if (play.pnlPct != null && Number.isFinite(play.pnlPct)) return play.pnlPct;
  return null;
}

/** Open-row primary metric labels — legacy uses stock progress, others use option P&L. */
export function openMetricsLabels(play: TerminalPlay): { current: string; peak: string } {
  if (play.horizon === "LEGACY") {
    return { current: "Stock", peak: "Day" };
  }
  return { current: "Current", peak: "Peak" };
}

/** Open-row metric values — honest null when the tape carries no number. */
export function openMetricsValues(play: TerminalPlay): {
  currentPct: number | null;
  peakPct: number | null;
} {
  if (play.horizon === "LEGACY") {
    return {
      currentPct: play.pnlPct ?? play.stockChangePct ?? null,
      peakPct: play.stockChangePct ?? null,
    };
  }
  return {
    currentPct: play.pnlPct ?? null,
    peakPct: play.peak ?? null,
  };
}

/** WATCH-row track metric — hypothetical move since flag, never entry P&L. */
export function watchMetricsValues(play: TerminalPlay): { trackPct: number | null } {
  return { trackPct: play.trackPct ?? null };
}

/** List-row headline: ticker + strike/right + DTE — e.g. SPXW 7595C 0DTE. */
export function playSymbolLine(play: TerminalPlay): string {
  const leg = play.contract.replace(/\s*·\s*/g, " ").trim();
  return `${play.ticker} ${leg}`;
}

/** Primary trigger/discovery instant for sort — ms since epoch; 0 when unknown. */
export function playTriggeredAtMs(play: TerminalPlay): number {
  const phase = playLifecyclePhase(play.status);
  const iso =
    phase === "watch"
      ? play.detectedAt ?? play.firstFlaggedAt
      : play.firstFlaggedAt ?? play.committedAt ?? play.detectedAt;
  if (!iso) return 0;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : 0;
}

/** Compact ET time(s) for the list rail — triggered→closed, or single event clock. */
export function playTimeRangeCompact(play: TerminalPlay): string | null {
  const phase = playLifecyclePhase(play.status);
  const triggered = play.firstFlaggedAt ? isoToEtClock(play.firstFlaggedAt) : null;
  if (phase === "closed") {
    const closed = play.exitAt ? isoToEtClock(play.exitAt) : null;
    if (triggered && closed) return `${triggered}→${closed}`;
    return closed ?? triggered;
  }
  if (phase === "watch") {
    const iso = play.detectedAt ?? play.firstFlaggedAt;
    return iso ? isoToEtClock(iso) : null;
  }
  return triggered;
}

/** Primary return % for the compact list column (peak when closed, else best live read). */
export function playListReturnPct(play: TerminalPlay): number | null {
  const phase = playLifecyclePhase(play.status);
  if (phase === "watch") return watchMetricsValues(play).trackPct;
  if (phase === "closed") {
    const peak = openMetricsValues(play).peakPct ?? play.peak;
    return peak ?? closedRealizedPct(play);
  }
  const { currentPct, peakPct } = openMetricsValues(play);
  const ret = peakPct ?? currentPct ?? play.pnlPct;
  return ret ?? null;
}
