import { fetchRecentFlows, insertHelixSignalOutcomes, fetchPendingHelixSignalCheckpoints, updateHelixSignalCheckpoint } from "@/lib/db";
import { detectVelocitySpikes, detectSplitFlow } from "@/features/helix/lib/helix-signal-detection";
import { DIRECTION_BASIS } from "@/features/helix/lib/helix-flow-aggression";
import { signalEligibility } from "@/features/helix/lib/helix-signal-detection";
import { fetchStockMinuteBars, fetchIndexMinuteBars } from "@/lib/providers/polygon";
import { flowPriceSymbol } from "@/lib/providers/flow-price-symbol";

/**
 * Helix signal-outcome ledger job (Tier 2 item #9, 2026-08-02 audit). Two halves, both
 * called from the same cron (src/app/api/cron/helix-signal-outcomes/route.ts):
 *
 *  1. record() — re-runs the SAME detection helix-signal-detection.ts uses live in the
 *     browser over the last hour of flow_alerts, and inserts newly-fired signals.
 *     price_at_fire comes from the firing print's own underlying_price — no live external call
 *     needed to record a firing.
 *
 *     THE SHARED DEFINITION DOES NOT MAKE THE TWO AGREE, and this comment used to say it did
 *     ("so client badge and persisted record can never disagree"). Same detector, DIFFERENT
 *     POPULATION: the browser runs it over `applyTapeFilters(tapeBuffer)` — the member's own
 *     ticker/side/premium filters applied to whatever the tape has streamed — while this job runs
 *     it over an unfiltered `since_hours: 1, limit: 5000` read straight from the DB. So a badge a
 *     member saw and a row this job wrote can legitimately differ, in both directions, and until
 *     now neither the row nor the panel said so (HELIX-MAP.md §9.6).
 *
 *     Every row therefore carries `context.population`, which is the precondition for ever using
 *     this ledger's follow-through rate to describe what a member actually SAW rather than what
 *     the cron happened to scan.
 *  2. grade() — for firings whose 5m/15m/1h checkpoint has actually elapsed, fetches the
 *     ticker's price at that moment from Polygon (the only point this touches an external
 *     API — recording never does) and fills the checkpoint; the 1h checkpoint also grades
 *     the final outcome (continued/reversed/flat vs. the firing's own direction read).
 *
 * Run async/best-effort off the market-worker cron cadence (user-confirmed 2026-08-02),
 * NOT inline on the member-facing /flows request — a DB write (or a slow/failed Polygon
 * call in grade()) must never add latency or a failure mode to the live page.
 */

const OUTCOME_FLAT_THRESHOLD_PCT = 0.1; // price move smaller than this reads as "flat", not a real direction

export function windowStartIso(nowMs: number, bucketMs: number): string {
  return new Date(Math.floor(nowMs / bucketMs) * bucketMs).toISOString();
}

/** How many ineligible tickers to NAME. Enough to identify the feed responsible without turning
 *  every ledger row into a ticker dump — measured live, the whole ineligible set is 2 tickers. */
const POPULATION_TICKER_SAMPLE = 20;

export type SignalPopulation = {
  /** Which reader produced the firing. The browser is `client_filtered`; this job is not. */
  source: "cron_unfiltered";
  since_hours: number;
  limit: number;
  scanned: number;
  signal_eligible: number;
  signal_ineligible: number;
  signal_ineligible_tickers: string[];
  client_equivalent: boolean;
};

/**
 * §9.6 — WHAT A FIRING WAS COMPUTED OVER.
 *
 * The detector is shared with the browser, which is why this job's header used to claim badge and
 * record "can never disagree". They can: same definition, DIFFERENT POPULATION. The browser runs it
 * over `applyTapeFilters(tapeBuffer)` — the member's own ticker/side/premium filters over whatever
 * has streamed — and this job runs it over an unfiltered DB read. Neither is wrong; they answer
 * different questions, and a row that does not say which one it answered cannot be used to describe
 * what a member saw.
 *
 * `signal_eligible` is the denominator BOTH detectors could actually see. A print with no real UW
 * timestamp cannot be placed in a window, and measured live 2026-08-23 that is 70% of the tape —
 * SPX and SPY (HELIX-MAP.md §9.0). A firing found among 1500 eligible prints and one found among 30
 * are not the same evidence, and without this they are indistinguishable in the record.
 *
 * Pure so it can be tested without a database — the job around it cannot.
 */
export function buildSignalPopulation(
  flows: Parameters<typeof signalEligibility>[0],
  params: { since_hours: number; limit: number }
): SignalPopulation {
  const eligibility = signalEligibility(flows);
  return {
    source: "cron_unfiltered",
    since_hours: params.since_hours,
    limit: params.limit,
    scanned: flows.length,
    signal_eligible: eligibility.eligible,
    signal_ineligible: eligibility.ineligible,
    // Named, not merely counted: "70% ineligible" is abstract, "SPX and SPY" is checkable.
    signal_ineligible_tickers: eligibility.ineligibleTickers.slice(0, POPULATION_TICKER_SAMPLE),
    // The client applies the member's filters before detecting; this job applies none. Stating it
    // makes the difference a fact in the row rather than something a reader must rediscover by
    // reading two files.
    client_equivalent: false,
  };
}

export async function recordHelixSignalFirings(nowMs = Date.now()): Promise<{ inserted: number; scanned: number }> {
  const flows = await fetchRecentFlows({ since_hours: 1, order: "recent", limit: 5000 });
  if (!flows.length) return { inserted: 0, scanned: 0 };

  // §9.6 — WHAT THIS FIRING WAS COMPUTED OVER. Stamped on every row so a reader can tell a ledger
  // firing from a badge a member saw, and so a follow-through rate is never quoted without the
  // population it was measured on.
  //
  // `eligible` is the denominator BOTH detectors could actually see: a print with no real UW
  // timestamp cannot be placed in a window, and measured live 2026-08-23 that is 70% of the tape
  // — SPX and SPY. A row that fired out of 1500 eligible prints and one that fired out of 30 are
  // not the same evidence, and without this the two are indistinguishable in the record.
  const population = buildSignalPopulation(flows, { since_hours: 1, limit: 5000 });

  const latestPriceByTicker = new Map<string, number>();
  for (const f of flows) {
    // fetchRecentFlows(order:"recent") is newest-first, so the FIRST row seen per ticker
    // is its most recent underlying_price — do not overwrite on subsequent (older) rows.
    if (f.underlying_price != null && !latestPriceByTicker.has(f.ticker)) {
      latestPriceByTicker.set(f.ticker, f.underlying_price);
    }
  }

  const velocitySpikes = detectVelocitySpikes(flows, nowMs);
  const splitFlows = detectSplitFlow(flows, nowMs);

  const rows: Parameters<typeof insertHelixSignalOutcomes>[0] = [
    ...velocitySpikes.map((s) => ({
      signal_type: "velocity_spike" as const,
      ticker: s.ticker,
      // 15-min bucket matches the detector's own recent-window size — a spike re-detected
      // within the same 15-min bucket across cron runs is the SAME firing, not a new one.
      window_start: windowStartIso(nowMs, 15 * 60_000),
      direction: null, // velocity spikes are a magnitude signal, not directional
      context: { recent: s.recent, prior: s.prior, ratio: s.ratio, recentPremium: s.recentPremium, population },
      price_at_fire: latestPriceByTicker.get(s.ticker) ?? null,
    })),
    ...splitFlows.map((s) => ({
      signal_type: "split_flow" as const,
      ticker: s.ticker,
      window_start: windowStartIso(nowMs, 30 * 60_000),
      direction: s.direction,
      // LEDGER CONTINUITY. `direction` is not a label here — `gradeOutcome` scores it as
      // continued/reversed, so this column is a PREDICTION the record grades. The rule that
      // produces it changed (option_type alone -> option type × aggressor side), and the two
      // sign-flipped on 44.6% of tickers when measured. Rows from the two eras therefore answer
      // different questions and their hit rates are not comparable. Stamping the basis is what
      // lets a reader separate them; pooling them would launder an unknown into a statistic.
      // Rows written before this field exists carry no basis, which IS the old rule.
      context: {
        callPremium: s.callPremium,
        putPremium: s.putPremium,
        callPct: s.callPct,
        total: s.total,
        direction_basis: DIRECTION_BASIS,
        directional: s.directional,
        population,
      },
      price_at_fire: latestPriceByTicker.get(s.ticker) ?? null,
    })),
  ];

  const inserted = await insertHelixSignalOutcomes(rows);
  return { inserted, scanned: flows.length };
}

async function priceNearMs(ticker: string, targetMs: number): Promise<number | null> {
  const from = String(targetMs - 5 * 60_000);
  const to = String(targetMs + 5 * 60_000);
  // INDEX ROOTS DO NOT LIVE IN THE EQUITY NAMESPACE. UW's tape carries the option root, so SPX /
  // SPXW / NDX / RUT / VIX arrive here as bare symbols that `/v2/aggs/ticker/SPX/...` answers with
  // HTTP 200, status OK and ZERO results — a silent empty success, not an error. Every index signal
  // therefore graded as "price unknown" forever. See flow-price-symbol.ts for the verified mapping
  // and why the Vector resolver (which defaults unknown input to SPX) must not be reused here.
  const resolved = flowPriceSymbol(ticker);
  if (!resolved) return null;
  try {
    const bars = resolved.isIndex
      ? await fetchIndexMinuteBars(resolved.symbol, from, to)
      : await fetchStockMinuteBars(resolved.symbol, from, to);
    const timed = bars.filter((b): b is typeof b & { t: number } => b.t != null);
    if (!timed.length) return null;
    // Closest bar to targetMs, not just the first/last — the market can be closed for
    // part of the window (e.g. grading right after the open).
    let best = timed[0];
    for (const b of timed) {
      if (Math.abs(b.t - targetMs) < Math.abs(best.t - targetMs)) best = b;
    }
    return best.c;
  } catch (e) {
    console.warn(`[helix-signal-outcomes] price lookup failed for ${ticker}:`, e);
    return null;
  }
}

export function gradeOutcome(direction: string | null, priceAtFire: number, price1h: number): "continued" | "reversed" | "flat" {
  const changePct = ((price1h - priceAtFire) / priceAtFire) * 100;
  if (Math.abs(changePct) < OUTCOME_FLAT_THRESHOLD_PCT) return "flat";
  if (direction === "bullish") return changePct > 0 ? "continued" : "reversed";
  if (direction === "bearish") return changePct < 0 ? "continued" : "reversed";
  // Velocity spikes carry no direction read — grade on whether price moved at all
  // (any real move past the flat threshold counts as "continued" activity, not a
  // directional call this signal never made).
  return "continued";
}

const CHECKPOINTS: Array<{ key: "price_5m" | "price_15m" | "price_1h"; minAgeMinutes: number; offsetMs: number }> = [
  { key: "price_5m", minAgeMinutes: 5, offsetMs: 5 * 60_000 },
  { key: "price_15m", minAgeMinutes: 15, offsetMs: 15 * 60_000 },
  { key: "price_1h", minAgeMinutes: 60, offsetMs: 60 * 60_000 },
];

export async function gradeHelixSignalOutcomes(limitPerCheckpoint = 100): Promise<{ graded: number }> {
  let graded = 0;
  for (const cp of CHECKPOINTS) {
    const pending = await fetchPendingHelixSignalCheckpoints(cp.key, cp.minAgeMinutes, limitPerCheckpoint);
    for (const row of pending) {
      if (row.price_at_fire == null) continue;
      const firedAtMs = new Date(row.fired_at).getTime();
      if (!Number.isFinite(firedAtMs)) continue;
      const price = await priceNearMs(row.ticker, firedAtMs + cp.offsetMs);
      if (price == null) continue; // leave pending — retried next run, never fabricated
      const outcome = cp.key === "price_1h" ? gradeOutcome(row.direction, row.price_at_fire, price) : undefined;
      await updateHelixSignalCheckpoint(row.id, cp.key, price, outcome);
      graded++;
    }
  }
  return { graded };
}
