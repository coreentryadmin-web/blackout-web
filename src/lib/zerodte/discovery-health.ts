// Per-lane discovery health — provenance for a board whose roster SHRANK.
//
// WHY THIS EXISTS: the 0DTE board is fed by three independent discovery origins (FLOW inside
// deriveZeroDteSetups, then BREAKOUT and PIN merged in by scan.ts). Both whole-market lanes are
// deliberately best-effort: `discoverBreakoutSetups` fails CLOSED to an empty setups list on a
// stale/unverifiable grouped-daily snapshot, and BOTH lanes sit inside a `try/catch` that degrades
// to "flow-only board this cycle" on any throw. That degradation is correct — a lane that cannot
// see should never fabricate candidates.
//
// What was missing is that it was also SILENT. The only trace was a `console.warn` on an ECS task;
// the served payload looked identical to a genuinely quiet session. Measured live 2026-08-14: two
// scan passes minutes apart served rosters of 84 and then 19 setups with nothing in either payload
// explaining the collapse — from outside, a 75% smaller board and a calm market are the same bytes.
//
// So this records, per lane, WHY it contributed what it contributed. It is a pure provenance
// signal in the same spirit as `ZeroDteScanResult.upstream_ok`: it never gates scoring, never
// changes which setups exist, and never adds a candidate. It only lets a reader tell
// "nothing qualified" from "this lane never ran".

/** Which discovery origins report health. FLOW is the base pipeline (its provenance is `upstream_ok`). */
export const DISCOVERY_HEALTH_LANES = ["BREAKOUT", "PIN"] as const;
export type DiscoveryHealthLane = (typeof DISCOVERY_HEALTH_LANES)[number];

/**
 * Why a lane contributed what it did.
 *
 * The load-bearing distinction is `ok` vs everything else: `ok` means the lane RAN and its count is
 * a real measurement of the market (zero included). Every other status means the count is not a
 * market read at all — it is an absence, and a reader must not average it in or call it quiet.
 */
export type DiscoveryLaneStatus =
  /** Ran to completion. `setups` is a genuine market read — including a genuine 0. */
  | "ok"
  /** Flag-gated off (ZERODTE_WHOLE_MARKET / ZERODTE_SRC_BREAKOUT / ZERODTE_SRC_PIN). */
  | "disabled"
  /** Outside the lane's own RTH window — expected, not a fault. */
  | "off_hours"
  /** Upstream returned an empty market snapshot; nothing to screen. */
  | "empty_market"
  /** Fail-closed: the snapshot could not be PROVEN fresh, so the lane declined to use it. */
  | "data_unavailable"
  /** The lane threw and was caught by scan.ts's best-effort guard. */
  | "failed";

export interface DiscoveryLaneHealth {
  status: DiscoveryLaneStatus;
  /** How many setups this lane contributed to the merge. Only meaningful as a market read when status === "ok". */
  setups: number;
  /** Optional machine-readable detail (e.g. the freshness reason behind `data_unavailable`). */
  reason?: string;
}

export type DiscoveryHealth = Record<DiscoveryHealthLane, DiscoveryLaneHealth>;

/**
 * The starting value: every lane `disabled` with zero setups.
 *
 * Defaulting to `disabled` rather than `ok` is deliberate and fail-closed in the reporting sense —
 * a lane that never got the chance to record its own status must not read as a healthy zero. Every
 * enabled lane overwrites this before the payload is built.
 */
export function initialDiscoveryHealth(): DiscoveryHealth {
  return {
    BREAKOUT: { status: "disabled", setups: 0 },
    PIN: { status: "disabled", setups: 0 },
  };
}

/**
 * Map `discoverBreakoutSetups`' discriminated outcome status onto a lane status.
 *
 * Kept as an explicit table rather than a passthrough so a NEW outcome status added upstream lands
 * on `failed` (an absence a reader will notice) instead of being silently forwarded as a string
 * nothing understands — which is the exact failure mode this module was written to end.
 */
export function laneStatusFromBreakoutOutcome(outcomeStatus: string): DiscoveryLaneStatus {
  switch (outcomeStatus) {
    case "ok":
      return "ok";
    case "skip_off_hours":
      return "off_hours";
    case "skip_empty_market":
      return "empty_market";
    case "data_unavailable":
      return "data_unavailable";
    default:
      return "failed";
  }
}

/**
 * True when at least one lane could not see this cycle — i.e. the roster is smaller than the
 * engine's real reach and the reader should say so rather than present it as the market's verdict.
 */
export function anyLaneDegraded(health: DiscoveryHealth): boolean {
  return DISCOVERY_HEALTH_LANES.some((lane) => {
    const s = health[lane].status;
    // `disabled` and `off_hours` are CONFIGURED absences, not degradation — a lane that is switched
    // off, or outside its own window, is behaving exactly as designed and must not raise an alarm.
    return s !== "ok" && s !== "disabled" && s !== "off_hours";
  });
}
