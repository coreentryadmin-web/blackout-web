/**
 * EVENT-DRIVEN SCAN TRIGGER — react to the tape, not just the clock.
 *
 * WHY (docs/audit/0DTE-RESEARCH.md): the 0DTE Command scanner runs on a ~5-minute cron. 0DTE lives on
 * reaction speed — a big aggressive short-dated sweep can move the board in seconds, and waiting up to
 * 5 minutes to notice it is an eternity on expiry day. This module lets a MATERIAL flow event fire an
 * out-of-band scan immediately, so the board reacts in real time. The cron stays as the heartbeat;
 * this only ADDS earlier reactions to the biggest events.
 *
 * PURE + THROTTLED: the classifier and the throttle test are pure (deterministic given inputs); the
 * only stateful piece is a tiny debouncer factory that caps trigger frequency so a burst of alerts
 * can't spam warmZeroDteBoard(). The scan itself is idempotent (ledger upserts), governor-throttled,
 * and self-skips outside the warm window — so an event trigger is always safe; the throttle is just to
 * avoid needless work.
 */

/** Only WHALE-size prints trigger an out-of-band scan — the board doesn't need to churn on small flow. */
export const EVENT_MIN_PREMIUM = 1_000_000;
/** Event triggers target the 0DTE board, so the print must be short-dated (0–1 DTE). */
export const EVENT_MAX_DTE = 1;
/** At most one event-triggered scan per this interval — well above the scan's cost, spam-proof. */
export const EVENT_MIN_INTERVAL_MS = 45_000;

/** The subset of a flow alert the materiality test needs. */
export type MaterialAlertInput = {
  premium: number;
  has_sweep: boolean;
  /** YYYY-MM-DD contract expiry. */
  expiry: string;
};

/** Calendar DTE of a YYYY-MM-DD expiry vs now (ET close basis). null when unparseable. */
export function dteOf(expiry: string, nowMs: number): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return null;
  const exp = Date.parse(`${expiry}T16:00:00-04:00`);
  if (!Number.isFinite(exp)) return null;
  return Math.round((exp - nowMs) / 86_400_000);
}

/**
 * Is this flow alert material enough to wake the 0DTE scanner out-of-band? A big (≥ $1M), swept,
 * short-dated (0–1 DTE) print — i.e. aggressive positioning on a contract the board actually trades.
 * Conservative on purpose: only the genuinely board-moving events trigger; everything else waits for
 * the next cron tick.
 */
export function isMaterialFlowAlert(flow: MaterialAlertInput, nowMs: number): boolean {
  if (!(flow.premium >= EVENT_MIN_PREMIUM)) return false;
  if (!flow.has_sweep) return false;
  const dte = dteOf(flow.expiry, nowMs);
  return dte != null && dte >= 0 && dte <= EVENT_MAX_DTE;
}

/** Pure throttle test — may a trigger fire now given the last fire time? */
export function canFire(lastFiredMs: number | null, nowMs: number, minIntervalMs = EVENT_MIN_INTERVAL_MS): boolean {
  return lastFiredMs == null || nowMs - lastFiredMs >= minIntervalMs;
}

/**
 * Stateful debouncer — caps event-trigger frequency regardless of alert volume. `maybeFire` runs the
 * callback and returns true iff enough time has passed since the last fire; otherwise it's a no-op.
 */
export function createScanDebouncer(minIntervalMs = EVENT_MIN_INTERVAL_MS): {
  maybeFire: (nowMs: number, fire: () => void) => boolean;
} {
  let lastFiredMs: number | null = null;
  return {
    maybeFire(nowMs, fire) {
      if (!canFire(lastFiredMs, nowMs, minIntervalMs)) return false;
      lastFiredMs = nowMs;
      fire();
      return true;
    },
  };
}
