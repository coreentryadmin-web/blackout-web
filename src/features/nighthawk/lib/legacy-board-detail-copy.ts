import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";

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

export function legacyMarkAgeLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.round(min / 60)}h ago`;
}
