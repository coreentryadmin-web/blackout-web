import { flowEventTimeMs } from "@/lib/flow-timestamp";
import {
  directionLabel,
  directionalPremium,
  type DirectionalPremium,
} from "@/features/helix/lib/helix-flow-aggression";

/**
 * Shared, framework-free detection logic for Helix's two persistable tape signals
 * (velocity spike, split flow). Extracted from FlowFeed.tsx's own useMemo blocks
 * (2026-08-02 Helix audit, Tier 2 item #9) so the client's live badges and the
 * server cron that persists signal firings for outcome grading can NEVER drift
 * into disagreeing about what counts as a spike/split — there is exactly one
 * definition, imported by both.
 *
 * "Coordinated" (dark-pool block + options sweep within 5min) is deliberately NOT
 * included here: it depends on a live UW dark-pool fetch (fetchDarkPoolPrints),
 * not a DB-backed table, so persisting it from a background cron would add a live
 * external-API dependency to a scheduled job. Tracked as an explicit, logged
 * follow-up (docs/audit/FINDINGS.md) rather than silently dropped.
 */

export type MinimalFlow = {
  ticker: string;
  option_type?: string | null;
  premium: number;
  event_at?: string | null;
  alerted_at?: string | null;
  tape_time_estimated?: boolean;
  /** Ask-side share of premium (0-100). Required for the DIRECTION read — without it every
   *  print is `undetermined`, which is honest but useless, so every caller must pass it.
   *  All three do: `fetchRecentFlows` selects it (db.ts `AS ask_pct`), and the client and Largo
   *  paths both carry full `FlowAlert` rows. */
  ask_pct?: number | null;
};

/**
 * Can this print fire a HELIX signal at all?
 *
 * Both detectors need to place a print IN TIME — a velocity spike is prints-per-window and a split
 * is call-vs-put premium inside a window. A print with no real UW timestamp cannot be placed, so
 * both correctly skip it. Neither is buggy. The defect (HELIX-MAP.md §9.0) is that **nothing said
 * so**, and the consequence is not small.
 *
 * MEASURED (live prod tape, 5000 rows / 168h, 2026-08-23): **1500 rows (30.0%) are signal-eligible;
 * 3500 (70.0%) can fire NEITHER signal — and those 3500 span exactly TWO tickers, SPX (3079) and
 * SPY (421).** They come from the second writer (§4A), an index feed that sends no time field, and
 * they carry ~92% of the tape's premium. So the two names that top every premium panel are
 * structurally incapable of producing either signal, and a member or a model reading "no velocity
 * spikes on SPX" concludes the tape was quiet when SPX was never scanned.
 *
 * WHY THIS IS ONE FUNCTION AND NOT A THIRD RULE. The two detectors expressed eligibility
 * differently — velocity tested `alert.event_at` directly, split called `flowEventTimeMs` — which
 * §9.9 flagged as one shape change from diverging. Adding a denominator computed by its own third
 * rule would have made that worse: a reported "eligible" count that neither detector actually uses
 * is the one-field-many-readers failure this lane has now fixed three times (§9.4, §9.5, §9.8,
 * §9.10). So eligibility is stated ONCE, here, and both detectors and the reported denominator read
 * it.
 *
 * The unification is BEHAVIOUR-NEUTRAL on live data, measured rather than assumed: across the same
 * 5000 rows the two rules selected **the same rows — 0 velocity-only, 0 split-only.** `flowEventTimeMs`
 * is the canonical helper ("real UW time only, never ingest fallback"), and is marginally the more
 * correct of the two: velocity's direct `event_at` test also discarded a row carrying a real,
 * non-estimated `alerted_at`, which is a genuine time.
 */
export function signalEligible(flow: MinimalFlow): boolean {
  return flowEventTimeMs(flow) != null;
}

export type SignalEligibility = {
  /** Every print the detectors were handed. */
  total: number;
  /** How many of them could be placed in time, i.e. the denominator the signals were computed over. */
  eligible: number;
  /** total − eligible. Non-zero means a "no signals" reading is partly a statement about coverage. */
  ineligible: number;
  /** Which tickers the ineligible prints belong to, commonest first. Named because "70% of the tape"
   *  is abstract while "SPX and SPY" is actionable — a member can see whether the name they care
   *  about was scanned at all. */
  ineligibleTickers: string[];
};

/** The denominator both signal surfaces must report. Pure; same input the detectors get. */
export function signalEligibility(flows: MinimalFlow[]): SignalEligibility {
  const counts = new Map<string, number>();
  let eligible = 0;
  for (const flow of flows) {
    if (signalEligible(flow)) eligible++;
    else counts.set(flow.ticker, (counts.get(flow.ticker) ?? 0) + 1);
  }
  return {
    total: flows.length,
    eligible,
    ineligible: flows.length - eligible,
    ineligibleTickers: Array.from(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([ticker]) => ticker),
  };
}

export type VelocitySpike = {
  ticker: string;
  recent: number;
  prior: number;
  ratio: number;
  recentPremium: number;
};

/**
 * How long ago a print happened — or `null` when it claims to be from the FUTURE.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────────────────────────
 *
 * Both detectors compared a raw `nowMs - eventMs` against their window:
 *
 *     detectVelocitySpikes:  const age = nowMs - eventMs; if (age <= RECENT_WINDOW) recent++
 *     detectSplitFlow:       if (ms == null || nowMs - ms > SPLIT_WINDOW_MS) continue
 *
 * A print stamped in the future gives a NEGATIVE age, and a negative number is `<=` every window
 * and `>` none. So a future-dated print counted as **maximally recent** in both.
 *
 * REPRODUCED against the real detectors: six prints stamped **one year ahead** of `nowMs` produced
 * a velocity spike (`recent=6, ratio=6`) and a split-flow firing ($3.0M call / $600k put). Not a
 * near-miss — a full firing, out of data that has not happened.
 *
 * ── HOW IT IS REACHED ───────────────────────────────────────────────────────────────────────────
 *
 * `resolveFlowTimes` does not bound `event_at` to the past, so any clock skew between UW and us, or
 * any timestamp that parses to the wrong magnitude, lands here. #2723 makes the second route
 * slightly wider: it parses epochs by magnitude, and a value that scales into 2027–2286 is
 * "valid" and still in the future.
 *
 * ── WHY THIS BUG SHAPE IS WORTH NAMING ──────────────────────────────────────────────────────────
 *
 * The identical error broke this lane's own velocity-cap harness earlier the same day: replaying
 * the detector at a historical `nowMs` made every LATER print in the session read as "the last
 * fifteen minutes", and the harness reported 91 simultaneous spikes with the cap binding 95.4% of
 * windows. The corrected figure was 14 and 11.3% — a 7x error, from exactly this sign. Having found
 * it in the instrument, the honest next step was to check whether the product had it too. It did.
 *
 * ── THE TOLERANCE IS NOT ZERO, DELIBERATELY ─────────────────────────────────────────────────────
 *
 * Rejecting anything even a millisecond ahead would drop real prints over ordinary clock skew
 * between UW's stamp and our clock. One minute is generous for skew and nowhere near a window, so a
 * genuinely mis-stamped print is still excluded while a normal one survives.
 */
export const FUTURE_PRINT_TOLERANCE_MS = 60 * 1000;

export function signalWindowAgeMs(
  eventMs: number | null,
  nowMs: number,
  toleranceMs: number = FUTURE_PRINT_TOLERANCE_MS
): number | null {
  if (eventMs == null || !Number.isFinite(eventMs)) return null;
  const age = nowMs - eventMs;
  // Beyond tolerance into the future: we cannot say when this happened, so it is evidence about
  // nothing. Clamping to 0 instead would silently make it the newest print on the tape.
  if (age < -toleranceMs) return null;
  return age;
}

const VELOCITY_RECENT_WINDOW_MS = 15 * 60 * 1000;
const VELOCITY_PRIOR_WINDOW_MS = 30 * 60 * 1000;
const VELOCITY_MIN_RECENT = 2;
const VELOCITY_MIN_RATIO = 3;

/** Prints-per-15min vs the prior 15min window, per ticker. `nowMs` is injected (not
 *  Date.now()) so the server cron and any test can pin a deterministic clock. */
export function detectVelocitySpikes(flows: MinimalFlow[], nowMs: number): VelocitySpike[] {
  const byTicker = new Map<string, { recent: number; prior: number; recentPremium: number }>();

  for (const alert of flows) {
    // Shared eligibility (see signalEligible) rather than a direct `event_at` test, so this
    // detector, detectSplitFlow and the reported denominator cannot drift apart.
    const eventMs = flowEventTimeMs(alert);
    // `null` for an undatable print AND for one dated beyond tolerance into the future — a
    // negative age is `<=` every window below, so an unguarded one counts as maximally recent.
    const age = signalWindowAgeMs(eventMs, nowMs);
    if (age == null) continue;
    const cur = byTicker.get(alert.ticker) ?? { recent: 0, prior: 0, recentPremium: 0 };
    if (age <= VELOCITY_RECENT_WINDOW_MS) {
      cur.recent++;
      cur.recentPremium += alert.premium;
    } else if (age <= VELOCITY_PRIOR_WINDOW_MS) {
      cur.prior++;
    }
    byTicker.set(alert.ticker, cur);
  }

  const spikes: VelocitySpike[] = [];
  for (const [ticker, { recent, prior, recentPremium }] of Array.from(byTicker)) {
    const ratio = recent / Math.max(1, prior);
    if (recent >= VELOCITY_MIN_RECENT && ratio >= VELOCITY_MIN_RATIO) {
      spikes.push({ ticker, recent, prior, ratio, recentPremium });
    }
  }
  spikes.sort((a, b) => b.ratio - a.ratio);
  return spikes;
}

export type SplitFlowEntry = {
  ticker: string;
  callPremium: number;
  putPremium: number;
  callPct: number;
  total: number;
  /**
   * What the flow says about the UNDERLYING, from option type × aggressor side — not from the
   * call/put premium split, which cannot tell a bought call from a sold one. See
   * `helix-flow-aggression.ts` for the measurement: the two rules SIGN-FLIP on 44.6% of tickers,
   * and this value is persisted and GRADED, so the old rule was scoring inverted predictions.
   *
   * `undetermined` when the aggressor side is unknown for most of the premium. It is not folded
   * into "mixed", which means "read successfully, and genuinely two-sided".
   */
  direction: "bullish" | "bearish" | "mixed" | "undetermined";
  /** The premium behind `direction`, so a consumer can see what the label rests on. */
  directional: DirectionalPremium;
};

const SPLIT_WINDOW_MS = 30 * 60 * 1000;
const SPLIT_MIN_LEG = 500_000;

/** Opposing call+put flow (>= $500K each leg) within a 30-min window, per ticker. */
export function detectSplitFlow(flows: MinimalFlow[], nowMs: number): SplitFlowEntry[] {
  // DETECTION IS UNCHANGED. What fires, and when, is exactly what it was: opposing call AND put
  // premium above the same leg threshold inside the same window. Only the DIRECTION this reports
  // changed — deliberately, because the firing is a persisted, graded row and altering when it
  // fires would break continuity of the record on top of correcting its label.
  const byTicker = new Map<string, { callPrem: number; putPrem: number; rows: MinimalFlow[] }>();

  for (const alert of flows) {
    // Same guard as the velocity detector: a negative age is `>` no window, so a future-dated
    // print used to slip into every one of them.
    const age = signalWindowAgeMs(flowEventTimeMs(alert), nowMs);
    if (age == null || age > SPLIT_WINDOW_MS) continue;
    const cur = byTicker.get(alert.ticker) ?? { callPrem: 0, putPrem: 0, rows: [] };
    if (alert.option_type === "CALL") cur.callPrem += alert.premium;
    else if (alert.option_type === "PUT") cur.putPrem += alert.premium;
    cur.rows.push(alert);
    byTicker.set(alert.ticker, cur);
  }

  const result: SplitFlowEntry[] = [];
  for (const [ticker, { callPrem, putPrem, rows }] of Array.from(byTicker)) {
    if (callPrem >= SPLIT_MIN_LEG && putPrem >= SPLIT_MIN_LEG) {
      const total = callPrem + putPrem;
      const callPct = Math.round((callPrem / total) * 100);
      const directional = directionalPremium(rows);
      result.push({
        ticker,
        callPremium: callPrem,
        putPremium: putPrem,
        callPct,
        total,
        direction: directionLabel(directional),
        directional,
      });
    }
  }
  return result.sort((a, b) => b.total - a.total);
}
