import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";

export function legacyWhyPickedSummary(play: TerminalPlay): string {
  if (play.thesis?.trim()) return play.thesis.trim();
  if (play.keySignal?.trim()) return play.keySignal.trim();
  if (play.recNote?.trim()) return play.recNote.trim();
  return "Evening scan ranked this setup from flow, technicals, and positioning.";
}

export function legacyMorningHeadline(play: TerminalPlay): string | null {
  const ms = play.morningStatus;
  if (!ms) return null;
  if (ms === "CONFIRMED") return "Pre-market confirmed — entry levels held";
  if (ms === "DEGRADED") return "Pre-market degraded — validate before entry";
  if (ms === "INVALIDATED") return "Invalidated at pre-market screening";
  if (ms === "UNVERIFIED") return "Morning confirm not run yet";
  return null;
}

export function legacyTopFactors(play: TerminalPlay, limit = 8) {
  return [...play.factors]
    .filter((f) => f.points !== 0)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, limit);
}
