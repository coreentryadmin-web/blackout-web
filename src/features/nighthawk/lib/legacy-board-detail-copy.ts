import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { ageSecFromIso } from "@/lib/ws/timestamp-freshness";

export function legacyWhyPickedSummary(play: TerminalPlay): string {
  if (play.thesis?.trim()) return play.thesis.trim();
  if (play.keySignal?.trim()) return play.keySignal.trim();
  if (play.recNote?.trim()) return play.recNote.trim();
  return "Evening scan ranked this setup from flow, technicals, and positioning.";
}

export function legacyMorningHeadline(play: TerminalPlay): string | null {
  if (play.morningReason?.trim()) return play.morningReason.trim();
  const ms = play.morningStatus;
  if (!ms) return null;
  if (ms === "CONFIRMED") return "Pre-market confirmed — entry levels held";
  if (ms === "DEGRADED") return "Pre-market degraded — validate before entry";
  if (ms === "INVALIDATED") return "Invalidated at pre-market screening";
  if (ms === "UNVERIFIED") return "Morning confirm not run yet";
  return null;
}

export function legacyTopFactors(play: TerminalPlay, limit = 12) {
  return [...play.factors]
    .filter((f) => f.points !== 0)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, limit);
}

export function legacyScorecardLine(play: TerminalPlay): string | null {
  const sc = play.scorecard;
  if (!sc) return null;
  const wr = Math.round(sc.winRate);
  const ci =
    sc.ciLow != null && sc.ciHigh != null
      ? ` (95% CI ${Math.round(sc.ciLow)}–${Math.round(sc.ciHigh)}%)`
      : "";
  const scope = sc.scope === "conviction_bucket" ? " · tier bucket" : "";
  return `${wr}% WR${ci} · avg ${sc.avg >= 0 ? "+" : ""}${sc.avg.toFixed(0)}% · n=${sc.n}${scope}`;
}

/**
 * Compact one-line variant of legacyScorecardLine for the board TABLE row itself (not the
 * click-through detail rail) — a table row has no room for the full CI/avg-return line, so this
 * keeps only what a member needs at a glance to gauge this pick's historical track record without
 * opening it: the win rate and the sample size it's built on (n is included specifically so a
 * high rate on a tiny n doesn't read as more settled than it is — same "never a confident rate
 * without its n" discipline legacyScorecardLine already follows).
 */
export function legacyScorecardBadge(play: TerminalPlay): string | null {
  const sc = play.scorecard;
  if (!sc) return null;
  return `${Math.round(sc.winRate)}% WR · n=${sc.n}`;
}

export function legacyMarkAgeLabel(iso: string | null | undefined): string | null {
  const sec = ageSecFromIso(iso);
  if (sec == null) return null;
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.round(min / 60)}h ago`;
}
