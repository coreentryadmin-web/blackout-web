/**
 * 0DTE Play Timeline — pure lifecycle event builder for the Command Deck terminal.
 *
 * Builds an honest vertical replay from pinned ledger data only. Times render when the
 * payload carries them (first flag, engine exit stamp, post-session tranche reconstruction).
 * Live trim/peak milestones without timestamps are shown WITHOUT fabricated clocks.
 */

import type { TerminalExitLadder } from "@/lib/zerodte/terminal-ladder";
import type { DeckStatus } from "@/features/nighthawk/command-deck/types";
// Type-only (erased at compile, zero runtime coupling to exit-engine.ts) — see
// realExitIsBarWalkReproducible below for why the VALUE (categorizeExitReason itself) is
// deliberately not imported here.
import type { ZeroDteExitReasonCategory } from "@/lib/zerodte/exit-engine";

export type PlayTimelineTranche = {
  tranche: number;
  fraction: number;
  exit_pnl_pct: number;
  exit_reason: string;
  at_et: string;
};

export type PlayTimelineEventKind =
  | "triggered"
  | "entry"
  | "milestone"
  | "trim"
  | "stop"
  | "exit"
  | "now"
  | "close";

export type PlayTimelineTimeSource = "live" | "engine" | "reconstructed" | "scheduled";

export type PlayTimelineEvent = {
  kind: PlayTimelineEventKind;
  label: string;
  detail?: string | null;
  /** ET wall clock HH:MM — null when unknown (never fabricated). */
  atEt: string | null;
  pnlPct?: number | null;
  timeSource: PlayTimelineTimeSource;
  /** Stable sort order within the session day. */
  order: number;
};

export type PlayTimelineInput = {
  status: DeckStatus;
  detectedAt?: string | null;
  firstFlaggedAt?: string | null;
  committedAtEt?: string | null;
  whyNowLabel?: string | null;
  entry?: number | null;
  pnlPct?: number | null;
  peak?: number | null;
  exitPolicy?: TerminalExitLadder | null;
  closedReason?: string | null;
  exitReason?: string | null;
  exitDetail?: string | null;
  exitAt?: string | null;
  exitPnlPct?: number | null;
  tranches?: PlayTimelineTranche[] | null;
  /** Current ET clock for the live "now" node — omit off-hours tests. */
  nowEt?: string | null;
};

/** ISO instant → ET HH:MM (America/New_York). */
export function isoToEtClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(ms);
  } catch {
    return null;
  }
}

/** Parse `committed_at_et` blobs like "2026-08-03 09:42 ET" or "09:42 ET". */
export function parseCommittedAtEt(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const m = raw.match(/(\d{1,2}:\d{2})/);
  return m?.[1] ?? null;
}

/** Normalize tranche `at_et` to HH:MM (accepts "10:42" or "10:42 ET"). */
export function normalizeTrancheEt(atEt: string): string | null {
  const m = atEt.match(/(\d{1,2}:\d{2})/);
  return m?.[1] ?? null;
}

/** ET clock → minutes since midnight for same-day ordering. */
export function etClockToMinutes(clock: string | null | undefined): number | null {
  if (!clock) return null;
  const m = clock.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

function formatSignedPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${Math.round(n)}%`;
}

function trancheLabel(t: PlayTimelineTranche): string {
  if (t.exit_reason === "trim_scale_first" || t.exit_reason === "trim_scale_second") return "Trim";
  if (t.exit_reason === "stopped") return "Stopped";
  if (t.exit_reason === "doubled") return "Target";
  if (t.exit_reason === "time_stop") return "Time stop";
  return "Exit";
}

function closeLabel(closedReason: string | null | undefined, exitReason: string | null | undefined): string {
  if (closedReason === "stopped") return "Stopped";
  if (closedReason === "time_stop") return "Close";
  if (exitReason === "target" || closedReason === "target") return "Target";
  if (exitReason === "thesis") return "Thesis exit";
  if (exitReason === "flat") return "Flat timeout";
  if (exitReason === "ratchet") return "Ratchet exit";
  if (closedReason === "ratchet") return "Ratchet exit";
  return "Close";
}

function pushEvent(events: PlayTimelineEvent[], event: Omit<PlayTimelineEvent, "order">, order: number): void {
  events.push({ ...event, order });
}

/**
 * FINDINGS 2026-10-16: mirrors record.ts's `realExitIsBarWalkReproducible` /
 * `managedGradeView` precedence (src/lib/zerodte/record.ts, ~line 428) — the same question,
 * asked here for the per-position Command Deck timeline instead of the aggregate win-rate
 * number. A genuine multi-tranche bar-walk reconstruction (`entry_context.executable.tranches`,
 * built post-session by replaying raw minute bars against the frozen plan) can end in a
 * TERMINAL leg (stopped/time_stop/doubled) while a REAL, live-only engine exit
 * (`entry_context.exit`) had already closed the position earlier (or later) for a reason the
 * bar-walk is structurally blind to: a GEX-wall/dealer-positioning thesis-break veto, a live
 * ratchet profit floor armed off the peak, or a theta-bleed flat timeout. None of those is
 * something `reconstructTrimScaleExecutableFromBars` (plan.ts) can see coming — it only ever
 * replays price against the plan's own fixed stop/target/time-stop — so once one of them fires,
 * the reconstruction's own terminal leg is not "more information", it is a FICTITIOUS
 * continuation of an already-closed position. A plain premium stop ("stop") or the trim-scale
 * ladder's own target/tranche exit ("target") is exactly the mechanism the reconstruction DOES
 * faithfully model, so those leave the reconstruction's terminal leg standing as the display.
 *
 * IMPORTANT — do NOT call `categorizeExitReason` (exit-engine.ts) on the value passed in here.
 * By the time an exit reason reaches this module it has ALREADY been run through
 * `categorizeExitReason` server-side: `zerodte-service.ts` stamps
 * `exit_reason: categorizeExitReason(pinnedExit.reason)` onto the ledger row (a
 * `ZeroDteExitReasonCategory | null`, not the raw `entry_context.exit.reason` string) before
 * `playTimelineInputFromTerminal` ever builds this function's input — confirmed by following
 * `TerminalPlay.exitReason` back through `adapters.ts`'s `exitReason: src.exit_reason ?? null`
 * to that typed field. `closeLabel` just below already relies on this (`exitReason === "thesis"`
 * etc. are category values, not raw reason strings). Re-categorizing an already-categorized
 * string would always return null (none of categorizeExitReason's raw-reason prefix checks
 * match a bare "stop"/"target"/"thesis"/…), which would silently treat every reproducible
 * stop/target exit as "live-only" too — exactly the regression requirement #4 forbids.
 *
 * An unrecognized or missing category fails CLOSED toward "live-only" (never suppress a real
 * close event behind a reconstruction we cannot positively vouch for) — the same fail-closed
 * posture record.ts's own realExitIsBarWalkReproducible documents.
 */
function realExitIsBarWalkReproducible(category: ZeroDteExitReasonCategory | string | null): boolean {
  return category === "stop" || category === "target";
}

/** Read WS-11 reconstructed tranches off entry_context.executable (server-side shape). */
export function readTimelineTranchesFromEntryContext(
  entryContext: Record<string, unknown> | null | undefined,
): PlayTimelineTranche[] | null {
  const ex = entryContext?.executable;
  if (!ex || typeof ex !== "object") return null;
  const raw = (ex as Record<string, unknown>).tranches;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: PlayTimelineTranche[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;
    const at = typeof t.at_et === "string" ? t.at_et : null;
    const pnl = typeof t.exit_pnl_pct === "number" && Number.isFinite(t.exit_pnl_pct) ? t.exit_pnl_pct : null;
    const reason = typeof t.exit_reason === "string" ? t.exit_reason : null;
    if (!at || pnl == null || !reason) continue;
    out.push({
      tranche: typeof t.tranche === "number" ? t.tranche : out.length + 1,
      fraction: typeof t.fraction === "number" ? t.fraction : 0,
      exit_pnl_pct: pnl,
      exit_reason: reason,
      at_et: at,
    });
  }
  return out.length > 0 ? out : null;
}

/** Read engine exit stamp off entry_context.exit. */
export function readExitStampFromEntryContext(entryContext: Record<string, unknown> | null | undefined): {
  at: string | null;
  pnl_pct: number | null;
  peak_pnl_pct: number | null;
  reason: string | null;
  detail: string | null;
  /** The observed exit mark before floor/stop honoring; null on legacy rows stamped before this
   *  field existed. See ZeroDteExitContext.mark_observed. */
  mark_observed: number | null;
  /** True when the frozen exit mark was raised to honor a protective floor/stop (an inferred fill,
   *  not the observed print). null (unknown), not false, on legacy rows that predate the flag —
   *  absence must never read as "definitely observed". */
  mark_honored: boolean | null;
} {
  const exit =
    entryContext && typeof entryContext.exit === "object"
      ? (entryContext.exit as Record<string, unknown>)
      : null;
  if (!exit) {
    return {
      at: null, pnl_pct: null, peak_pnl_pct: null, reason: null, detail: null,
      mark_observed: null, mark_honored: null,
    };
  }
  return {
    at: typeof exit.at === "string" ? exit.at : null,
    pnl_pct: typeof exit.pnl_pct === "number" && Number.isFinite(exit.pnl_pct) ? exit.pnl_pct : null,
    peak_pnl_pct:
      typeof exit.peak_pnl_pct === "number" && Number.isFinite(exit.peak_pnl_pct) ? exit.peak_pnl_pct : null,
    reason: typeof exit.reason === "string" ? exit.reason : null,
    detail: typeof exit.detail === "string" ? exit.detail : null,
    mark_observed:
      typeof exit.mark_observed === "number" && Number.isFinite(exit.mark_observed) ? exit.mark_observed : null,
    // Only a real boolean counts; a missing field stays null (unknown provenance) so a legacy row
    // is never reported as an observed fill it might not be.
    mark_honored: typeof exit.mark_honored === "boolean" ? exit.mark_honored : null,
  };
}

/**
 * Build the vertical play timeline. Every timestamp is real or explicitly absent — never guessed.
 */
export function buildPlayTimeline(input: PlayTimelineInput): PlayTimelineEvent[] {
  const events: PlayTimelineEvent[] = [];
  let order = 0;

  const detectedEt = isoToEtClock(input.detectedAt);
  if (detectedEt) {
    pushEvent(events, {
      kind: "triggered",
      label: "Detected",
      detail: null,
      atEt: detectedEt,
      timeSource: "live",
    }, order++);
  }

  const flagEt = isoToEtClock(input.firstFlaggedAt);
  if (flagEt) {
    pushEvent(events, {
      kind: "triggered",
      label: "Triggered",
      detail: input.whyNowLabel ?? null,
      atEt: flagEt,
      timeSource: "live",
    }, order++);
  }

  const entryEt = parseCommittedAtEt(input.committedAtEt) ?? flagEt;
  if (entryEt) {
    pushEvent(events, {
      kind: "entry",
      label: "Entry",
      detail: input.entry != null ? `$${input.entry.toFixed(2)}` : null,
      atEt: entryEt,
      timeSource: "live",
    }, order++);
  }

  const hasReconstructed = (input.tranches?.length ?? 0) > 0;
  const isClosed = input.status === "CLOSED";
  const isTerminalTrancheReason = (reason: string): boolean =>
    reason === "stopped" || reason === "time_stop" || reason === "doubled";
  const trancheTerminal = hasReconstructed && input.tranches!.some((t) => isTerminalTrancheReason(t.exit_reason));
  // FINDINGS 2026-10-16: a REAL, live-only exit (entry_context.exit, categorized thesis/
  // ratchet/flat — see realExitIsBarWalkReproducible above) always outranks the bar-walk
  // reconstruction's own TERMINAL leg, the same precedence record.ts's managedGradeView
  // already applies to the aggregate win-rate number. Computed BEFORE the tranche-push loop
  // below so the fictitious terminal leg can be left out of the rendered replay entirely,
  // rather than pushed and then needing to be un-rendered — the earlier legs (real partial
  // banks that happened before the live-only exit took over) are unaffected either way.
  const hasRealExit = input.exitPnlPct != null;
  const realExitIsLiveOnly =
    isClosed && trancheTerminal && hasRealExit && !realExitIsBarWalkReproducible(input.exitReason ?? null);
  if (hasReconstructed) {
    for (const t of input.tranches!) {
      // Drop the fictitious terminal leg itself when a real, live-only exit supersedes it —
      // never render both a fictitious "Target"/"Stopped" node AND the real close for the same
      // position. Simply APPENDING the real close event (instead of dropping this leg) is not
      // sufficient: the two timestamps can fall on EITHER side of each other (confirmed live —
      // ARM's real ratchet-floor close landed 6 minutes AFTER its fictitious terminal leg, BB's
      // real flat-timeout close landed 3 HOURS BEFORE its fictitious terminal leg), so the
      // chronological event sort below can't be trusted to disambiguate "what really happened"
      // from "what the bar-walk fictitiously kept doing" on its own.
      if (realExitIsLiveOnly && isTerminalTrancheReason(t.exit_reason)) continue;
      const atEt = normalizeTrancheEt(t.at_et);
      const kind: PlayTimelineEventKind =
        t.exit_reason === "stopped"
          ? "stop"
          : t.exit_reason.startsWith("trim_scale")
            ? "trim"
            : t.exit_reason === "doubled"
              ? "milestone"
              : "exit";
      pushEvent(events, {
        kind,
        label: trancheLabel(t),
        detail: formatSignedPct(t.exit_pnl_pct),
        atEt,
        pnlPct: t.exit_pnl_pct,
        timeSource: "reconstructed",
      }, order++);
    }
  } else if (input.exitPolicy?.policy === "trim_scale") {
    for (const level of input.exitPolicy.trim_levels) {
      if (!level.fired) continue;
      pushEvent(events, {
        kind: "trim",
        label: "Trim",
        detail: `+${Math.round(level.trigger_pct)}% · banked at peak`,
        atEt: null,
        pnlPct: level.trigger_pct,
        timeSource: "live",
      }, order++);
    }
  }

  const peakPct = input.peak;
  if (peakPct != null && Number.isFinite(peakPct) && peakPct !== 0 && !hasReconstructed) {
    pushEvent(events, {
      kind: "milestone",
      label: formatSignedPct(peakPct),
      detail: "Session high",
      atEt: null,
      pnlPct: peakPct,
      timeSource: "live",
    }, order++);
  }

  // `!trancheTerminal`: no fictitious terminal leg at all (ratchet-mode plays, or a trim_scale
  // row whose reconstruction never armed a trim) — render the real close as before.
  // `realExitIsLiveOnly`: a fictitious terminal leg WAS dropped above in favor of the real,
  // live-only exit — render that real close here too, in its place. Bar-walk-reproducible
  // (stop/target) terminal legs, and the no-real-exit case, leave this `false` and fall through
  // unchanged: the reconstruction's own terminal leg stands as the display, no redundant node.
  if (isClosed && (!trancheTerminal || realExitIsLiveOnly)) {
    const exitEt = isoToEtClock(input.exitAt);
    const finalPnl = input.exitPnlPct ?? input.pnlPct;
    pushEvent(events, {
      kind: input.closedReason === "stopped" ? "stop" : "close",
      label: closeLabel(input.closedReason, input.exitReason),
      detail: input.exitDetail ?? formatSignedPct(finalPnl),
      atEt: exitEt,
      pnlPct: finalPnl,
      timeSource: exitEt ? "engine" : input.closedReason === "time_stop" ? "scheduled" : "live",
    }, order++);
  } else if (!isClosed && (input.status === "OPEN" || input.status === "HOLD" || input.status === "TRIM")) {
    if (input.pnlPct != null && Number.isFinite(input.pnlPct)) {
      pushEvent(events, {
        kind: "now",
        label: formatSignedPct(input.pnlPct),
        detail: "Live",
        atEt: input.nowEt ?? null,
        pnlPct: input.pnlPct,
        timeSource: "live",
      }, order++);
    }
    const closeEt = input.exitPolicy?.time_stop_et ?? "15:50";
    pushEvent(events, {
      kind: "close",
      label: "Close",
      detail: `${closeEt} ET hard stop`,
      atEt: closeEt,
      timeSource: "scheduled",
    }, order++);
  }

  events.sort((a, b) => {
    const am = etClockToMinutes(a.atEt);
    const bm = etClockToMinutes(b.atEt);
    if (am != null && bm != null && am !== bm) return am - bm;
    if (am != null && bm == null) return -1;
    if (am == null && bm != null) return 1;
    return a.order - b.order;
  });

  return events;
}

export function timelineHasTimedReplay(events: PlayTimelineEvent[]): boolean {
  return events.some((e) => e.timeSource === "reconstructed" || e.timeSource === "engine");
}

export function timelineFootnote(events: PlayTimelineEvent[]): string | null {
  if (timelineHasTimedReplay(events)) {
    return "Trim and exit times reconstructed from session bars after the close.";
  }
  const hasUntimed = events.some((e) => e.atEt == null && e.kind !== "close");
  if (hasUntimed) {
    return "Live board — trim and peak times appear after session grade unless engine-stamped.";
  }
  return null;
}
