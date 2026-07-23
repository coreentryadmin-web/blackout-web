/**
 * ADAPTIVE SCAN CADENCE — scan rate follows the information-arrival rate (design-review #4).
 *
 * A flat ~2-minute cron treats 9:35 (ranges forming, flow exploding) the same as 12:30 (lunch chop). But
 * the rate at which NEW tradeable information arrives varies enormously across the session, so the scan floor
 * should too — fast at the open and into the close, relaxed midday. Not "faster is always better": scanning
 * every 30s at lunch just burns provider quota on an unchanged tape.
 *
 * This is the FLOOR between scans; the event triggers (sweeps / gamma-flip crosses) still fire the scan
 * early on top of it — cadence bounds the quiet periods, events handle the bursts. PURE & deterministic.
 */

export type ScanPhase = "PRE_OPEN" | "OPENING_DRIVE" | "MORNING" | "MIDDAY" | "POWER_HOUR" | "LATE" | "CLOSED";

export interface ScanCadence {
  phase: ScanPhase;
  /** Floor between scans, ms. null = idle (no RTH scanning). */
  intervalMs: number | null;
  reason: string;
}

const SEC = 1000;

/**
 * Cadence from the ET clock. `etMinutes` is minutes since the 9:30 open (10:00 → 30; negative = pre-open).
 * `isTradingDay` gates the whole thing — a holiday/weekend is CLOSED regardless of clock.
 */
export function scanCadence(etMinutes: number, isTradingDay = true): ScanCadence {
  if (!isTradingDay) return { phase: "CLOSED", intervalMs: null, reason: "not a trading day" };
  if (!Number.isFinite(etMinutes)) return { phase: "CLOSED", intervalMs: null, reason: "unknown session time" };

  // Pre-open warm: the feeds are live and morning positioning is forming, but no RTH scan yet — a slow keep-warm.
  if (etMinutes < 0) return { phase: "PRE_OPEN", intervalMs: 120 * SEC, reason: "pre-market warm" };
  // 9:30–10:15 — opening drive: ranges forming, flow at its heaviest, engines arming. Fastest floor.
  if (etMinutes < 45) return { phase: "OPENING_DRIVE", intervalMs: 30 * SEC, reason: "opening drive — heaviest information arrival" };
  // 10:15–11:00 — morning trend establishing.
  if (etMinutes < 90) return { phase: "MORNING", intervalMs: 60 * SEC, reason: "morning trend forming" };
  // 11:00–14:30 — midday chop: information arrival slows; relax the floor to conserve quota.
  if (etMinutes < 300) return { phase: "MIDDAY", intervalMs: 180 * SEC, reason: "midday — slow tape, event triggers carry it" };
  // 15:00–15:30 — power hour: positioning + gamma into the close accelerates again.
  if (etMinutes < 360) return { phase: "POWER_HOUR", intervalMs: 30 * SEC, reason: "power hour — gamma/positioning into the close" };
  // 15:30–16:00 — late session: winding down, no fresh entries but manage open risk.
  if (etMinutes < 390) return { phase: "LATE", intervalMs: 60 * SEC, reason: "late session — manage, no fresh entries" };
  // After the cash close.
  return { phase: "CLOSED", intervalMs: null, reason: "after the close" };
}

/** Convenience: cadence from ET wall-clock parts (hour/minute), 9:30 open. */
export function scanCadenceFromEt(hour: number, minute: number, isTradingDay = true): ScanCadence {
  return scanCadence(hour * 60 + minute - 570, isTradingDay);
}
