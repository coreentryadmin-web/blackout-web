import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { aggregateZeroDteFunnel } from "@/lib/admin-zerodte-funnel";
import { buildDiscoveryFunnelHint } from "@/lib/zerodte/discovery-funnel-hint";

/**
 * The MEMBER board and the ADMIN funnel disagreed on every counter.
 *
 * `aggregateZeroDteFunnel` counts kinds inside its sample window, and `exactOr` prefers a true
 * aggregate when one is supplied. #2402 wired that for the admin funnel. `fetchDiscoveryFunnelHint`
 * — a SECOND caller of the same aggregator — was left supplying nothing, so it fell back to the
 * sample on every field. It is the surface members actually see.
 *
 * MEASURED ON PROD 2026-08-20 20:17Z, both read at the same instant, AFTER #2402 deployed:
 *
 *                          board     admin    truth
 *     commit_events            0         7    7 ledger rows
 *     gate_blocked_events    305     3,239
 *     detected_tickers        47       157
 *
 * The board reported ZERO commits on a day that committed seven plays and halted the governor on
 * six realized losers. Mechanism: the newest-N window. With 3,239 gate-blocked events the newest
 * 500 are all late-session blocks, so the commits (14:08-14:44Z) sit outside the window entirely.
 *
 * This is the blast-radius miss CLAUDE.md's PR policy names explicitly: "duplicated logic in a
 * second file counts — fix and note all of them, not just the one you tripped over."
 */

const SRC = readFileSync(join(process.cwd(), "src/lib/zerodte/discovery-funnel-hint.ts"), "utf8");

/** A saturated window: newest-N is all gate_blocked, the commits fell off the end. */
const SATURATED_EVENTS = Array.from({ length: 500 }, (_, i) => ({
  kind: "gate_blocked",
  ticker: `T${i % 47}`,
  gate: "plan_illiquid",
  session_date: "2026-08-20",
})) as never[];

test("REGRESSION: exact counts beat the saturated sample on the MEMBER path", () => {
  const sampledOnly = aggregateZeroDteFunnel({
    session_date: "2026-08-20",
    events: SATURATED_EVENTS,
    rejections: [],
    events_sample_capped: true,
    rejections_sample_capped: false,
  });
  // Reproduces the prod bug exactly: the sample genuinely contains no commits.
  assert.equal(buildDiscoveryFunnelHint(sampledOnly).commit_events, 0);

  const withExact = aggregateZeroDteFunnel({
    session_date: "2026-08-20",
    events: SATURATED_EVENTS,
    rejections: [],
    events_sample_capped: true,
    rejections_sample_capped: false,
    exact_kind_counts: { gate_blocked: 3239, commit: 7 },
    exact_detected_tickers: 157,
  });
  const hint = buildDiscoveryFunnelHint(withExact);
  assert.equal(hint.commit_events, 7, "the 7 real commits must survive a saturated window");
  assert.equal(hint.gate_blocked_events, 3239);
  assert.equal(hint.detected_tickers, 157);
});

test("a legitimate exact ZERO is not overwritten by a sampled non-zero", () => {
  // `?? undefined` vs `||` — a real zero is data, not a missing value. Getting this wrong would
  // resurrect phantom commits on a day that genuinely committed none.
  const agg = aggregateZeroDteFunnel({
    session_date: "2026-08-20",
    events: [{ kind: "commit", ticker: "X", session_date: "2026-08-20" }] as never[],
    rejections: [],
    events_sample_capped: false,
    rejections_sample_capped: false,
    exact_kind_counts: { commit: 0 },
    exact_detected_tickers: 0,
  });
  assert.equal(buildDiscoveryFunnelHint(agg).commit_events, 0, "exact zero must win");
});

test("the member fetch actually SUPPLIES the exact counts", () => {
  // Asserted on source: the real fetch needs a database. The defect was an OMISSION at the call
  // site, and an omission is exactly what a source check can see.
  assert.match(SRC, /countZeroDteDiscoveryEventsByKind/, "must query exact kind counts");
  assert.match(SRC, /countZeroDteDetectedTickers/, "must query exact detected tickers");
  assert.match(SRC, /exact_kind_counts: exactKinds \?\? null/);
  assert.match(SRC, /exact_detected_tickers: exactDetected \?\? null/);
});

test("an exact-count failure degrades that field only — it never kills the strip", () => {
  // Best-effort, independently: one failing count must not blank the whole member strip, which
  // would trade an understated number for no number at all.
  assert.match(SRC, /countZeroDteDiscoveryEventsByKind\(sessionDate\)\.catch\(\(\) => null\)/);
  assert.match(SRC, /countZeroDteDetectedTickers\(sessionDate\)\.catch\(\(\) => null\)/);
});

test("the SAMPLE is still used for the distribution", () => {
  // Only the TOTALS move to exact. `by_gate` ranking and the capped flags are about the
  // distribution and are legitimately sampled — widening those is a different, costlier change.
  assert.match(SRC, /limit: 500/);
  assert.match(SRC, /events_sample_capped: events\.length >= 500/);
});
