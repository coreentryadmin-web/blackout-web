import type { DeckStatus, TerminalPlay } from "./types";
import { isoToEtClock, parseCommittedAtEt } from "@/lib/zerodte/play-timeline";

/** Which lifecycle bucket drives the left-rail card layout. */
export type PlayLifecyclePhase = "open" | "watch" | "closed";

export type FreshnessTier = "just_fired" | "fresh" | "aging" | "late" | "closed";

/** Green pulse — trade fired within the last ~3 minutes. */
export const FRESHNESS_JUST_FIRED_MS = 3 * 60_000;
/** Still green — under ~15 minutes since the primary event. */
export const FRESHNESS_FRESH_MS = 15 * 60_000;
/** Amber — 15–30 minutes; no pulse. */
export const FRESHNESS_AGING_MS = 30 * 60_000;

export function playLifecyclePhase(status: DeckStatus): PlayLifecyclePhase {
  if (status === "CLOSED") return "closed";
  if (status === "WATCH" || status === "SKIP") return "watch";
  return "open";
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

export function eventAgeMs(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso || !(nowMs > 0)) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const delta = nowMs - at;
  return delta >= 0 ? delta : 0;
}

export function freshnessTierFromAge(ageMs: number | null, phase: PlayLifecyclePhase): FreshnessTier {
  if (phase === "closed") return "closed";
  if (ageMs == null) return "fresh";
  if (ageMs <= FRESHNESS_JUST_FIRED_MS) return "just_fired";
  if (ageMs <= FRESHNESS_FRESH_MS) return "fresh";
  if (ageMs <= FRESHNESS_AGING_MS) return "aging";
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
    return { label: "Published", iso: play.detectedAt ?? play.firstFlaggedAt ?? null };
  }
  return { label: "Triggered", iso: play.firstFlaggedAt ?? null };
}

/** Secondary timestamp for closed rows — when the trade started. */
export function playTriggeredEvent(play: TerminalPlay): { label: string; iso: string | null } {
  return { label: "Triggered", iso: play.firstFlaggedAt ?? null };
}

export function playStatusLabel(status: DeckStatus): string {
  if (status === "CLOSED") return "CLOSED";
  if (status === "WATCH" || status === "SKIP") return "WATCHING";
  return "ACTIVE";
}

export function setupTypeLabel(play: TerminalPlay): string | null {
  const o = play.discoveryOrigin?.[0];
  if (!o) return null;
  return o.replace(/_/g, " ");
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
};

export function playFreshnessDisplay(
  play: TerminalPlay,
  nowMs: number,
  primaryIso: string | null,
): PlayFreshnessDisplay {
  const phase = playLifecyclePhase(play.status);
  const ageMs = eventAgeMs(primaryIso, nowMs);
  const tier = freshnessTierFromAge(ageMs, phase);
  return {
    tier,
    badgeLabel: freshnessBadgeLabel(tier, ageMs),
    pulse: tier === "just_fired" && phase === "open",
    lateEntry: tier === "late" && phase === "open",
    relativeAge: formatRelativeAge(primaryIso, nowMs),
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

/** Realized return on a closed row — exit stamp first, then live P&L. */
export function closedRealizedPct(play: TerminalPlay): number | null {
  if (play.status !== "CLOSED") return null;
  if (play.exitPnlPct != null && Number.isFinite(play.exitPnlPct)) return play.exitPnlPct;
  if (play.pnlPct != null && Number.isFinite(play.pnlPct)) return play.pnlPct;
  return null;
}
