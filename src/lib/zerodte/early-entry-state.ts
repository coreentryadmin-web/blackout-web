// EARLY-ENTRY state machine — turns a developing-pressure read (early-entry-pressure.ts) into
// the operator's explicitly required WATCH / ENTRY separation.
//
// OPERATOR'S OWN WORDS: "Separate WATCH from ENTRY. WATCH identifies a developing setup; ENTRY
// requires a defined price trigger and confirmation. Show the invalidation level and expire
// stale signals."
//
// DETERMINISTIC, STATELESS BY CONSTRUCTION: rather than persisting mutable cross-cycle state
// (a Redis record a scan would have to read/write/expire), this recomputes the WHOLE state from
// the day's bars every call — the same "pure function of real bars, re-derived each scan" idiom
// momentum-signal-discovery.ts already used. `classifySetup` is given bars up to "now" and
// internally WALKS them forward from the first bar where pressure was first detected to find
// whether/when a trigger, invalidation, or expiry happened since — so calling it live with
// "all bars so far" and calling it historically with "bars sliced at minute i" (the no-look-ahead
// backtest discipline) are the exact same code path, never two implementations that could drift.
//
// LEVEL/INVALIDATION ARE FROZEN AT WATCH DETECTION: once a coil is first detected, the level and
// invalidation price are fixed to that moment's read — they do not keep redrawing every bar
// thereafter (a moving target would never actually invalidate or trigger).

import { detectDevelopingPressure, type PressureBar, type PressureRead } from "./early-entry-pressure";

export type SetupState = "NO_SETUP" | "WATCH" | "ENTRY" | "EXPIRED" | "INVALIDATED";

export type RatedBar = { bar: PressureBar; rvolRatio: number | null };

/** Forwarded verbatim to `detectDevelopingPressure` — same fields, same defaults, minus the
 *  per-call bars/direction/rvolRatio this module itself supplies at each walked minute. */
export type PressureOpts = {
  compressionWindowMin?: number;
  levelLookbackMin?: number;
  compressionMaxRatio?: number;
  compressionMaxAbsPct?: number;
  levelTestTolerancePct?: number;
  minLevelTests?: number;
};

export type SetupClassification = {
  state: SetupState;
  direction: "long" | "short";
  /** The level this coil is testing (frozen at watch detection). Null when no watch ever formed. */
  level: number | null;
  /** Breaking THIS level the wrong way invalidates the thesis (frozen at watch detection). */
  invalidation_level: number | null;
  /** Price that must be closed beyond, in the setup's direction, to count as a real ENTRY trigger
   *  (level +/- `triggerConfirmPct`, never the bare level itself — a touch is not a break). */
  trigger_price: number | null;
  watch_detected_at_ms: number | null;
  watch_expires_at_ms: number | null;
  entry_triggered_at_ms: number | null;
  invalidated_at_ms: number | null;
  /** The pressure read AT THE CURRENT (last) bar — diagnostic, always present once a watch has
   *  formed, so a caller can see the live coil quality even after it has since triggered. */
  pressure: PressureRead | null;
};

const DEFAULT_WATCH_TTL_MIN = 45;
const DEFAULT_TRIGGER_CONFIRM_PCT = 0.1;
const DEFAULT_RVOL_FLOOR = 1.5;

function sortedRated(rated: RatedBar[]): RatedBar[] {
  return [...rated].filter((r) => Number.isFinite(r.bar.t)).sort((a, b) => a.bar.t - b.bar.t);
}

/**
 * Pure. `rated` must be bars-with-their-own-RVOL-at-that-minute, sorted ascending, containing
 * ONLY bars up to "now" (the caller's own no-look-ahead discipline — this function never peeks
 * ahead of the last element). Returns NO_SETUP when a coil never formed at all this session.
 */
export function classifySetup(input: {
  rated: RatedBar[];
  direction: "long" | "short";
  pressureOpts?: PressureOpts;
  watchTtlMin?: number;
  triggerConfirmPct?: number;
  rvolFloor?: number;
}): SetupClassification {
  const rated = sortedRated(input.rated);
  const watchTtlMin = input.watchTtlMin ?? DEFAULT_WATCH_TTL_MIN;
  const triggerConfirmPct = input.triggerConfirmPct ?? DEFAULT_TRIGGER_CONFIRM_PCT;
  const rvolFloor = input.rvolFloor ?? DEFAULT_RVOL_FLOOR;

  const base: SetupClassification = {
    state: "NO_SETUP",
    direction: input.direction,
    level: null,
    invalidation_level: null,
    trigger_price: null,
    watch_detected_at_ms: null,
    watch_expires_at_ms: null,
    entry_triggered_at_ms: null,
    invalidated_at_ms: null,
    pressure: null,
  };

  // Find the FIRST index where pressure first developed (the watch's own birth moment).
  let watchIdx = -1;
  let pressureAtWatch: PressureRead | null = null;
  for (let i = 0; i < rated.length; i++) {
    const barsSoFar = rated.slice(0, i + 1).map((r) => r.bar);
    const pressure = detectDevelopingPressure({
      bars: barsSoFar,
      direction: input.direction,
      rvolRatio: rated[i]!.rvolRatio,
      rvolFloor,
      ...input.pressureOpts,
    });
    if (pressure.developing) {
      watchIdx = i;
      pressureAtWatch = pressure;
      break;
    }
  }
  if (watchIdx === -1) return base; // never coiled this session -- NO_SETUP

  const level = pressureAtWatch!.level!;
  const watchDetectedAtMs = rated[watchIdx]!.bar.t;
  const watchExpiresAtMs = watchDetectedAtMs + watchTtlMin * 60_000;
  const triggerPrice = input.direction === "long"
    ? level * (1 + triggerConfirmPct / 100)
    : level * (1 - triggerConfirmPct / 100);
  // Invalidation = the compression window's OWN opposite extreme at watch-detection time (a break
  // the wrong way out of the exact range that was coiling means the coil failed, not merely that
  // price hasn't yet broken the level under test).
  const compressionWindowMin = input.pressureOpts?.compressionWindowMin ?? 15;
  const compressionWindowBars = rated
    .slice(Math.max(0, watchIdx - (compressionWindowMin - 1)), watchIdx + 1)
    .map((r) => r.bar);
  const invalidationLevel = input.direction === "long"
    ? Math.min(...compressionWindowBars.map((b) => b.l))
    : Math.max(...compressionWindowBars.map((b) => b.h));

  const result: SetupClassification = {
    ...base,
    state: "WATCH",
    level: Math.round(level * 100) / 100,
    invalidation_level: Math.round(invalidationLevel * 100) / 100,
    trigger_price: Math.round(triggerPrice * 10000) / 10000,
    watch_detected_at_ms: watchDetectedAtMs,
    watch_expires_at_ms: watchExpiresAtMs,
    pressure: pressureAtWatch,
  };

  for (let i = watchIdx + 1; i < rated.length; i++) {
    const { bar, rvolRatio } = rated[i]!;
    const triggeredByPrice = input.direction === "long" ? bar.c >= triggerPrice : bar.c <= triggerPrice;
    const rvolConfirms = rvolRatio != null && rvolRatio >= rvolFloor;
    if (triggeredByPrice && rvolConfirms) {
      result.state = "ENTRY";
      result.entry_triggered_at_ms = bar.t;
      result.pressure = detectDevelopingPressure({
        bars: rated.slice(0, i + 1).map((r) => r.bar),
        direction: input.direction,
        rvolRatio,
        rvolFloor,
        ...input.pressureOpts,
      });
      return result;
    }
    const invalidatedByPrice = input.direction === "long" ? bar.c <= invalidationLevel : bar.c >= invalidationLevel;
    if (invalidatedByPrice) {
      result.state = "INVALIDATED";
      result.invalidated_at_ms = bar.t;
      return result;
    }
    if (bar.t > watchExpiresAtMs) {
      result.state = "EXPIRED";
      return result;
    }
  }
  // Reached "now" still inside the watch window, un-triggered and un-invalidated.
  return result;
}
