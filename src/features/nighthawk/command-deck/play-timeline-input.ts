import type { TerminalPlay } from "./types";
import type { PlayTimelineInput } from "@/lib/zerodte/play-timeline";
import { isoToEtClock } from "@/lib/zerodte/play-timeline";

/** Map a TerminalPlay to the pure timeline builder input. */
export function playTimelineInputFromTerminal(
  play: TerminalPlay,
  nowMs?: number,
): PlayTimelineInput {
  return {
    status: play.status,
    firstFlaggedAt: play.firstFlaggedAt ?? null,
    committedAtEt: play.thesisHealth?.committedAtEt ?? null,
    whyNowLabel: play.whyNow?.label ?? play.whyNow?.reason ?? null,
    entry: play.entry ?? null,
    pnlPct: play.pnlPct ?? null,
    peak: play.peak ?? null,
    exitPolicy: play.exitPolicy ?? null,
    closedReason: play.closedReason ?? null,
    exitReason: play.exitReason ?? null,
    exitDetail: play.exitDetail ?? null,
    exitAt: play.exitAt ?? null,
    exitPnlPct: play.exitPnlPct ?? null,
    tranches: play.timelineTranches ?? null,
    nowEt: nowMs != null ? isoToEtClock(new Date(nowMs).toISOString()) : null,
  };
}
