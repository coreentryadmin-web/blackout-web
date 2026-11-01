import test from "node:test";
import assert from "node:assert/strict";

import {
  UNIVERSE_ROW_MAX_AGE_MS,
  isCompleteBuild,
  mergeUniverseSnapshot,
} from "./vector-universe-merge";

const NOW = 1_787_070_000_000;
const row = (ticker: string, ageMs = 0) => ({ ticker, asOf: NOW - ageMs });
const snap = (tickers: string[], ageMs = 0) => ({
  updatedAt: NOW - ageMs,
  rows: tickers.map((t) => row(t, ageMs)),
});

test("isCompleteBuild only passes a fan-out that lost nothing", () => {
  assert.equal(isCompleteBuild(21, 21), true);
  assert.equal(isCompleteBuild(21, 4), false);
  assert.equal(isCompleteBuild(21, 20), false);
  // Nothing attempted is not a complete build — it is no evidence at all, and must never be
  // allowed to replace a healthy roster with an empty one.
  assert.equal(isCompleteBuild(0, 0), false);
});

// LIVE INCIDENT (2026-09-20): GET /api/market/vector/universe served 18/55 rows spot:null
// (COIN, MSTR, PLTR, JPM, GS, ...) while a same-tick, uncontended GET /api/market/gex-heatmap
// for those same tickers returned a real spot in under a second. `buildVectorUniverseRow`
// ALWAYS returns a row object, even when `fetchGexHeatmap` fell back to spot:null after
// blocking past its budget — so `attempted === produced` (row-count fan-out completeness) was
// true even though a third of the rows carried no usable data, and the old 2-arg
// `isCompleteBuild` let that "complete" build bypass the merge and replace the stored snapshot
// outright, discarding any previous good spot with zero carry-forward protection.
test("isCompleteBuild also requires the produced rows to carry USABLE data, not just exist", () => {
  // Every ticker produced a row (21/21), but only 15 of them resolved a usable spot — the exact
  // "block-cap timeout still returns A row" shape. Must NOT be treated as complete.
  assert.equal(isCompleteBuild(21, 21, 15), false);
  // All three bars clear: genuinely complete.
  assert.equal(isCompleteBuild(21, 21, 21), true);
  // Backward-compatible default: a caller that only tracks row count (doesn't pass the third
  // arg) gets the OLD two-bar behavior unchanged.
  assert.equal(isCompleteBuild(21, 21), true);
});

test("THE PRODUCTION INCIDENT: a 4-row build must not erase a 64-row roster", () => {
  // Measured live 2026-08-18: an incomplete fan-out persisted AMZN/FN/QQQ/SOXL over a healthy
  // 64-ticker snapshot, and it was served — ageing from 258s to 318s — for minutes.
  const healthy = snap(
    Array.from({ length: 64 }, (_, i) => `T${String(i).padStart(2, "0")}`),
    60_000
  );
  const partial = [row("AMZN"), row("FN"), row("QQQ"), row("SOXL")];

  const merged = mergeUniverseSnapshot(healthy, partial, NOW);

  // 64 carried + 4 new = 68 distinct tickers. The roster GREW; it did not collapse to 4.
  assert.equal(merged.rows.length, 68);
  assert.equal(merged.refreshed, 4);
  assert.equal(merged.carried, 64);
  assert.equal(merged.expired, 0);
  for (const t of ["AMZN", "FN", "QQQ", "SOXL"]) {
    assert.ok(merged.rows.some((r) => r.ticker === t), `${t} present`);
  }
});

test("a fresh row REPLACES the stored row for the same ticker", () => {
  const previous = { updatedAt: NOW - 60_000, rows: [{ ticker: "SPY", asOf: NOW - 60_000, spot: 1 }] };
  const merged = mergeUniverseSnapshot(previous, [{ ticker: "SPY", asOf: NOW, spot: 2 }], NOW);
  assert.equal(merged.rows.length, 1);
  assert.equal((merged.rows[0] as { spot: number }).spot, 2, "the newer observation wins");
  // Refreshed, not carried — a ticker cannot be counted as both.
  assert.equal(merged.refreshed, 1);
  assert.equal(merged.carried, 0);
});

test("rows nobody refreshes eventually expire, so the universe CAN shrink", () => {
  // The guard must not become a ratchet that pins dead tickers forever.
  const stale = snap(["DEAD"], UNIVERSE_ROW_MAX_AGE_MS + 1_000);
  const merged = mergeUniverseSnapshot(stale, [row("LIVE")], NOW);
  assert.deepEqual(merged.rows.map((r) => r.ticker), ["LIVE"]);
  assert.equal(merged.expired, 1);
});

// BUG FIX (2026-09-03): a future-dated stamp (cross-process clock skew across the ECS tasks that
// write asOf/updatedAt) used to produce a negative age that never exceeded maxAgeMs, carrying an
// untrustworthy row forward indefinitely instead of expiring it.
test("a row stamped well in the future is expired, not carried forward as extra-fresh", () => {
  const stored = snap(["FUTURE"], -10 * 60_000); // asOf 10 minutes AHEAD of NOW
  const merged = mergeUniverseSnapshot(stored, [], NOW);
  assert.deepEqual(merged.rows, []);
  assert.equal(merged.expired, 1);
});

test("a row stamped a few seconds ahead of now (ordinary clock skew) still survives", () => {
  const stored = snap(["A"], -2_000); // asOf 2s AHEAD of NOW
  const merged = mergeUniverseSnapshot(stored, [], NOW);
  assert.equal(merged.rows.length, 1);
});

test("a row just inside the age limit survives; just outside it does not", () => {
  const inside = mergeUniverseSnapshot(snap(["A"], UNIVERSE_ROW_MAX_AGE_MS - 1), [], NOW);
  assert.equal(inside.rows.length, 1);
  const outside = mergeUniverseSnapshot(snap(["A"], UNIVERSE_ROW_MAX_AGE_MS + 1), [], NOW);
  assert.equal(outside.rows.length, 0);
});

test("an undated stored row is aged against the snapshot's own timestamp", () => {
  // Otherwise a row with no asOf would live forever and the shrink path would never fire.
  const fresh = { updatedAt: NOW - 1_000, rows: [{ ticker: "A", asOf: null }] };
  assert.equal(mergeUniverseSnapshot(fresh, [], NOW).rows.length, 1);

  const old = { updatedAt: NOW - UNIVERSE_ROW_MAX_AGE_MS - 1_000, rows: [{ ticker: "A", asOf: null }] };
  assert.equal(mergeUniverseSnapshot(old, [], NOW).rows.length, 0);
});

test("an undated row that keeps failing to refresh eventually expires across REPEATED cycles", () => {
  // The single-cycle test above pins the age formula, but every real refresh persists its own
  // `updatedAt = Date.now()` (see refreshVectorUniverseSnapshot) and feeds that snapshot back in
  // as the NEXT cycle's `previous`. An undated row's fallback stamp must not be reset by that —
  // otherwise a ticker whose builder keeps failing (real incident: META serving spot:null/
  // asOf:null indefinitely while a solo GET for the same ticker returns real data) never ages out,
  // because each cycle's `previous.updatedAt` is recent and its "age" against that never grows.
  let snap = { updatedAt: NOW, rows: [{ ticker: "META", asOf: null }] };
  const CYCLE_MS = 5 * 60_000; // the 5-min universe rebuild cadence
  let now = NOW;
  for (let i = 0; i < 4; i++) {
    now += CYCLE_MS;
    const merged = mergeUniverseSnapshot(snap, [], now);
    snap = { updatedAt: now, rows: merged.rows };
  }
  // 4 cycles * 5min = 20min > UNIVERSE_ROW_MAX_AGE_MS (15min) of real elapsed time — the row must
  // have expired by now, not survived by perpetually resetting its own age clock.
  assert.deepEqual(
    snap.rows.map((r) => r.ticker),
    [],
    "an undated row must expire once it has genuinely been unrefreshed longer than maxAgeMs, " +
      "even though every intervening cycle bumped the snapshot's own updatedAt"
  );
});

test("an undated row that keeps being ATTEMPTED (present in fresh, still no asOf) also expires across REPEATED cycles", () => {
  // Same real incident as the test above, reached through the OTHER branch: a ticker whose chain
  // fetch keeps failing but is still IN the fan-out every cycle (not dropped from it) lands in
  // `fresh` every time with asOf still null. The fresh-row loop must carry forward the
  // `undatedSince` the previous-row loop already froze for it, not reset to nowMs just because
  // this cycle's freshly-built row object doesn't itself carry that field yet.
  let snap = { updatedAt: NOW, rows: [{ ticker: "META", asOf: null }] };
  const CYCLE_MS = 5 * 60_000;
  let now = NOW;
  for (let i = 0; i < 4; i++) {
    now += CYCLE_MS;
    const merged = mergeUniverseSnapshot(snap, [{ ticker: "META", asOf: null }], now);
    snap = { updatedAt: now, rows: merged.rows };
  }
  assert.deepEqual(
    snap.rows.map((r) => r.ticker),
    [],
    "a ticker re-attempted every cycle but never dated must still expire once genuinely stale " +
      "longer than maxAgeMs — being present in `fresh` every cycle must not reset its age clock"
  );
});

test("tickers are keyed case- and whitespace-insensitively", () => {
  const previous = { updatedAt: NOW, rows: [{ ticker: "spy", asOf: NOW }] };
  const merged = mergeUniverseSnapshot(previous, [{ ticker: " SPY ", asOf: NOW }], NOW);
  assert.equal(merged.rows.length, 1, "same ticker must not appear twice");
});

test("output is sorted and deterministic", () => {
  const merged = mergeUniverseSnapshot(snap(["ZZ", "AA"]), [row("MM")], NOW);
  assert.deepEqual(merged.rows.map((r) => r.ticker), ["AA", "MM", "ZZ"]);
});

test("merge tolerates empty, null and unusable input", () => {
  assert.deepEqual(mergeUniverseSnapshot(null, null, NOW).rows, []);
  assert.deepEqual(mergeUniverseSnapshot(undefined, undefined, NOW).rows, []);
  // A row with no ticker cannot be keyed and must not blow up or produce a phantom entry.
  assert.deepEqual(mergeUniverseSnapshot(null, [{ ticker: "", asOf: NOW }], NOW).rows, []);
});

// LIVE INCIDENT (2026-09-20), the merge-layer half of the same defect: even when a null-spot
// build IS routed through the merge (isCompleteBuild's fix above), the merge itself used to let
// an undated fresh row (no new evidence) overwrite a previous, genuinely-dated carried row —
// destroying the exact data the merge exists to protect, on the very cycle it should have been
// preserved.
test("an undated fresh row must NOT overwrite a still-good dated carried row for the same ticker", () => {
  const previous = { updatedAt: NOW - 60_000, rows: [{ ticker: "COIN", asOf: NOW - 60_000, spot: 194.6 }] };
  // This cycle's build re-attempted COIN, hit the block-cap fallback, and produced spot:null /
  // asOf:null — evidence of nothing new, not evidence the old spot is wrong.
  const merged = mergeUniverseSnapshot(previous, [{ ticker: "COIN", asOf: null, spot: null }], NOW);
  assert.equal(merged.rows.length, 1);
  assert.equal(
    (merged.rows[0] as { spot: number | null }).spot,
    194.6,
    "the real, still-fresh spot must survive an undated re-attempt, not be nulled out"
  );
  // Already counted as carried by the previous-rows loop; the undated re-attempt must not
  // double-count it as refreshed too (a ticker cannot be both, per the invariant above).
  assert.equal(merged.carried, 1);
  assert.equal(merged.refreshed, 0);
});

test("an undated fresh row STILL overwrites once the previously-carried row has genuinely gone stale", () => {
  // The guard above must not become a NEW ratchet: once the carried row itself expires (dropped
  // by the previous-rows loop), an undated fresh re-attempt behaves exactly as before — it can
  // still start (and later expire) its own undatedSince clock, so a permanently-dead ticker still
  // shrinks out of the universe eventually.
  const previous = {
    updatedAt: NOW - (UNIVERSE_ROW_MAX_AGE_MS + 1_000),
    rows: [{ ticker: "DEAD", asOf: NOW - (UNIVERSE_ROW_MAX_AGE_MS + 1_000), spot: 1 }],
  };
  const merged = mergeUniverseSnapshot(previous, [{ ticker: "DEAD", asOf: null, spot: null }], NOW);
  assert.equal(merged.rows.length, 1, "still attempted this cycle, so it re-enters as undated");
  assert.equal((merged.rows[0] as { spot: number | null }).spot, null);
  assert.equal(merged.expired, 1, "the stale carried row was correctly dropped first");
  assert.equal(merged.refreshed, 1);
});

test("an empty build carries the whole stored roster forward untouched", () => {
  // The worst case — a fan-out where EVERYTHING failed — must be a no-op, not a wipe.
  const healthy = snap(["A", "B", "C"], 30_000);
  const merged = mergeUniverseSnapshot(healthy, [], NOW);
  assert.deepEqual(merged.rows.map((r) => r.ticker), ["A", "B", "C"]);
  assert.equal(merged.refreshed, 0);
  assert.equal(merged.carried, 3);
});
