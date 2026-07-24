// src/lib/swing/scan-cadence.ts — phase-anchored cadence for the swing-discovery cron (PR-13). PURE.
//
// WHY (docs/audit/SWING-ENGINE.md §4 PR-13): a swing thesis builds across SESSIONS, not seconds, so its
// discovery cron is anchored to a handful of meaningful points in the day rather than a fixed N-minute
// heartbeat. EventBridge fires the route on a WIDE UTC band; THIS module decides — from the ET wall clock —
// which discovery PHASE (if any) that firing belongs to. The plan ships POST_CLOSE first (the cleanest
// full-session accumulation read) and defines the other four phases so they light up as the plan rolls out.
//
// IDEMPOTENT PER (date, phase) — the load-bearing invariant: a phase fires ONCE per session day. Because
// EventBridge fires the route many times inside a phase's window (and a redeploy/retry can re-fire it), the
// cron must not double-write the accumulation memory (a re-run would re-increment observation_count for the
// same day). The idempotency key is `(sessionDay, phase)`; the shell claims it before scanning and skips if
// it is already claimed. This module is the PURE decision — given the ET clock and the set of already-claimed
// keys it returns run/skip — so the phase logic and its idempotency are unit-testable without a clock or a DB.

import type { SwingDiscoveryPhase } from "./discovery";

/** One discovery phase's ET wall-clock window, as minutes since ET midnight. Windows are non-overlapping;
 *  gaps (e.g. the pre-dawn hours) simply map to no phase → the cron self-skips that firing. */
export interface SwingScanPhaseWindow {
  phase: SwingDiscoveryPhase;
  label: string;
  /** Inclusive lower bound, ET minutes since midnight. */
  startMin: number;
  /** Exclusive upper bound, ET minutes since midnight. */
  endMin: number;
  /** POST_CLOSE ships first (the cleanest full-session accumulation read); the rest follow the rollout. */
  primary: boolean;
}

const hm = (h: number, m: number): number => h * 60 + m;

/**
 * The five discovery phases. POST_CLOSE is listed first (primary) — it is the phase the plan ships on, and
 * the stable render/iteration order puts it at the head. Correctness does NOT depend on this order (resolution
 * is by range containment), only the render/first-of order does.
 */
export const SWING_SCAN_PHASES: readonly SwingScanPhaseWindow[] = [
  // Post-close (16:15–20:00 ET): the full session has printed — the cleanest read of the day's accumulation.
  { phase: "POST_CLOSE", label: "Post-close (4:15–8:00 PM ET)", startMin: hm(16, 15), endMin: hm(20, 0), primary: true },
  // Pre-open (6:00–9:15 ET): overnight + pre-market positioning ahead of the session.
  { phase: "PRE_OPEN", label: "Pre-open (6:00–9:15 AM ET)", startMin: hm(6, 0), endMin: hm(9, 15), primary: false },
  // Midday (12:00–13:00 ET): the lunch lull — a stable intraday checkpoint away from the open/close noise.
  { phase: "MIDDAY", label: "Midday (12:00–1:00 PM ET)", startMin: hm(12, 0), endMin: hm(13, 0), primary: false },
  // Power hour (15:00–16:00 ET): the closing drive, where multi-day theses often get their final confirmation.
  { phase: "POWER_HOUR", label: "Power hour (3:00–4:00 PM ET)", startMin: hm(15, 0), endMin: hm(16, 0), primary: false },
  // Overnight (20:00–24:00 ET): after the post-close settle — captures late/after-hours repositioning.
  { phase: "OVERNIGHT", label: "Overnight (8:00 PM–midnight ET)", startMin: hm(20, 0), endMin: hm(24, 0), primary: false },
] as const;

/**
 * Minutes since ET midnight for an epoch-ms instant. Uses the ET wall clock (handles DST via the tz db).
 * Pure given `nowMs`. Midnight can format as hour "24" in some ICU builds — folded back to 0 with `% 24`.
 */
export function etMinutesOfDay(nowMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(nowMs));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/** The phase window owning this ET instant, or null when the clock falls in a gap between windows. */
export function resolveScanPhase(nowMs: number): SwingScanPhaseWindow | null {
  const mins = etMinutesOfDay(nowMs);
  return SWING_SCAN_PHASES.find((w) => mins >= w.startMin && mins < w.endMin) ?? null;
}

/** The idempotency key for one (sessionDay, phase) firing — the claim the shell sets to make a re-fire a no-op. */
export function phaseRunKey(sessionDay: string, phase: SwingDiscoveryPhase): string {
  return `swing:discovery:${sessionDay}:${phase}`;
}

export interface SwingScanDecision {
  /** True only when the ET clock is inside a phase window AND that (date, phase) has NOT already run. */
  run: boolean;
  phase: SwingDiscoveryPhase | null;
  window: SwingScanPhaseWindow | null;
  /** The idempotency key for this firing (null when no phase is active). */
  key: string | null;
  reason: string;
}

/**
 * Decide whether THIS firing should run a discovery scan. Pure: given the ET clock, the session day, and the
 * set of already-claimed `(date, phase)` keys, it returns run/skip with the phase + idempotency key. The shell
 * supplies `ranKeys` from its persistent claim store, so a second firing inside the same phase window on the
 * same day (a retry, an overlapping EventBridge tick) is skipped — the (date, phase) idempotency invariant.
 */
export function decideSwingScan(args: {
  nowMs: number;
  sessionDay: string;
  ranKeys: ReadonlySet<string>;
}): SwingScanDecision {
  const window = resolveScanPhase(args.nowMs);
  if (!window) {
    return { run: false, phase: null, window: null, key: null, reason: "no active discovery phase at this ET time" };
  }
  const key = phaseRunKey(args.sessionDay, window.phase);
  if (args.ranKeys.has(key)) {
    return { run: false, phase: window.phase, window, key, reason: `phase ${window.phase} already ran for ${args.sessionDay} (idempotent skip)` };
  }
  return { run: true, phase: window.phase, window, key, reason: `phase ${window.phase} active — run discovery` };
}
