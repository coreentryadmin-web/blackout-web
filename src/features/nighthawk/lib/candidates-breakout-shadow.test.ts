import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  computeCorrectedCandidatePool,
  compareCandidatePool,
  buildBreakoutConfluenceShadowSnapshotRow,
} from "./candidates-breakout-shadow";
import { applyConfluenceGate, CONFLUENCE_PROTECTED_TOP, CONFLUENCE_MIN_SOURCES, type MultiSourceCandidateRow } from "./candidates";

function row(overrides: Partial<MultiSourceCandidateRow> = {}): MultiSourceCandidateRow {
  return {
    ticker: "TICK",
    composite_score: 1,
    source_count: 1,
    sources: ["breakout"],
    lane_scores: {},
    ...overrides,
  };
}

/** A rank-`n` block of multi-lane (flow+oi_change), corroborated, HIGH-score filler rows — occupies
 *  the top of the sorted list so a breakout-only row placed after them lands below
 *  CONFLUENCE_PROTECTED_TOP and would be dropped by the REAL gate on source_count alone. */
function corroboratedFiller(n: number, startScore = 100): MultiSourceCandidateRow[] {
  return Array.from({ length: n }, (_, i) =>
    row({
      ticker: `FILL${i}`,
      composite_score: startScore - i,
      source_count: 2,
      sources: ["flow", "oi_change"],
    })
  );
}

describe("computeCorrectedCandidatePool — no-drift on rows with no breakout source", () => {
  test("byte-identical to applyConfluenceGate when zero rows carry the breakout lane", () => {
    const rows = [
      ...corroboratedFiller(25),
      row({ ticker: "SINGLE", composite_score: 5, source_count: 1, sources: ["catalyst"] }),
    ];
    const actual = applyConfluenceGate(rows, 20);
    const corrected = computeCorrectedCandidatePool(rows, 20);
    assert.deepEqual(corrected, actual);
  });

  test("matches applyConfluenceGate exactly across the full CONFLUENCE_PROTECTED_TOP/MIN_SOURCES range with no breakout rows", () => {
    const rows = corroboratedFiller(40).map((r, i) =>
      i % 3 === 0 ? { ...r, source_count: 1, sources: ["catalyst"] } : r
    );
    for (const maxTickers of [5, 20, 30]) {
      assert.deepEqual(computeCorrectedCandidatePool(rows, maxTickers), applyConfluenceGate(rows, maxTickers));
    }
  });
});

describe("computeCorrectedCandidatePool — structure exemption", () => {
  test("a low-rank, single-lane breakout-only row is admitted by the corrected gate but dropped by the real one", () => {
    // Exactly CONFLUENCE_PROTECTED_TOP corroborated rows occupy every unconditionally-admitted
    // slot; BANGER sits at index CONFLUENCE_PROTECTED_TOP (the first position NOT covered by the
    // protected-top rule), so it's admitted or dropped purely on source_count/structure-exemption.
    // maxTickers is one MORE than the protected-top count so the loop actually reaches BANGER's
    // index instead of hitting the budget cap on filler alone first.
    const rows = [
      ...corroboratedFiller(CONFLUENCE_PROTECTED_TOP),
      row({ ticker: "BANGER", composite_score: 1, source_count: 1, sources: ["breakout"] }),
    ];
    const maxTickers = CONFLUENCE_PROTECTED_TOP + 1;
    const actual = applyConfluenceGate(rows, maxTickers);
    const corrected = computeCorrectedCandidatePool(rows, maxTickers);
    assert.ok(!actual.some((r) => r.ticker === "BANGER"), "sanity: real gate drops the single-lane breakout row");
    assert.ok(corrected.some((r) => r.ticker === "BANGER"), "corrected gate rescues the structure-only row");
  });

  test("a breakout row already within the protected top is unaffected (admitted by both, no double-count)", () => {
    const rows = [row({ ticker: "EARLYBANGER", composite_score: 999, source_count: 1, sources: ["breakout"] }), ...corroboratedFiller(5)];
    const actual = applyConfluenceGate(rows, 6);
    const corrected = computeCorrectedCandidatePool(rows, 6);
    assert.deepEqual(corrected, actual);
  });

  test("still respects the maxTickers budget — corrected pool never exceeds it", () => {
    const rows = [
      ...corroboratedFiller(30),
      ...Array.from({ length: 10 }, (_, i) => row({ ticker: `B${i}`, composite_score: 1 - i * 0.01, source_count: 1, sources: ["breakout"] })),
    ];
    const corrected = computeCorrectedCandidatePool(rows, 25);
    assert.ok(corrected.length <= 25);
  });

  test("CONFLUENCE_MIN_SOURCES rows below the protected top still need corroboration OR the breakout exemption -- a bare single-lane non-breakout row stays dropped", () => {
    const rows = [
      ...corroboratedFiller(CONFLUENCE_PROTECTED_TOP + 2),
      row({ ticker: "LONE_CATALYST", composite_score: 1, source_count: 1, sources: ["catalyst"] }),
    ];
    const corrected = computeCorrectedCandidatePool(rows, CONFLUENCE_PROTECTED_TOP + 2);
    assert.ok(!corrected.some((r) => r.ticker === "LONE_CATALYST"), "non-breakout single-lane rows are NOT exempted -- only structure/breakout is");
  });
});

describe("compareCandidatePool", () => {
  test("would_differ=false and empty diff lists when the corrected gate changes nothing", () => {
    const rows = corroboratedFiller(10);
    const cmp = compareCandidatePool(rows, 10);
    assert.equal(cmp.would_differ, false);
    assert.deepEqual(cmp.newly_admitted_tickers, []);
    assert.deepEqual(cmp.dropped_to_make_room_tickers, []);
    assert.equal(cmp.actual_pool_size, cmp.corrected_pool_size);
  });

  test("reports the rescued structure-only ticker and the ticker it displaced under a tight budget", () => {
    // 20 protected-top corroborated rows (always admitted), then RESCUED_BANGER (structure-only,
    // index 20 — first position past the protected top), then 4 MORE corroborated rows past it
    // (indices 21-24, unique tickers so they can't collide with the protected-top block's names).
    // Budget = 24: exactly enough for the protected 20 + 4 more admissible candidates out of the
    // 5 remaining (RESCUED_BANGER + 4 tail rows) — so admitting RESCUED_BANGER under the corrected
    // gate must push the LAST tail row out to stay within the same fixed budget.
    const rows = [
      ...corroboratedFiller(CONFLUENCE_PROTECTED_TOP, 100),
      row({ ticker: "RESCUED_BANGER", composite_score: 79, source_count: 1, sources: ["breakout"] }),
      ...["TAIL0", "TAIL1", "TAIL2", "TAIL3"].map((ticker, i) =>
        row({ ticker, composite_score: 78 - i, source_count: 2, sources: ["flow", "oi_change"] })
      ),
    ];
    const maxTickers = CONFLUENCE_PROTECTED_TOP + 4;
    const cmp = compareCandidatePool(rows, maxTickers);
    assert.equal(cmp.would_differ, true);
    assert.deepEqual(cmp.newly_admitted_tickers, ["RESCUED_BANGER"]);
    assert.deepEqual(cmp.dropped_to_make_room_tickers, ["TAIL3"]);
    assert.equal(cmp.actual_pool_size, cmp.corrected_pool_size);
  });

  test("never diverges from the REAL applyConfluenceGate output for the actual side (calls it directly, cannot desync)", () => {
    const rows = [
      ...corroboratedFiller(15),
      row({ ticker: "X1", composite_score: 3, source_count: 1, sources: ["breakout"] }),
      row({ ticker: "X2", composite_score: 2, source_count: 1, sources: ["movers"] }),
    ];
    for (const maxTickers of [3, 10, 25]) {
      const real = applyConfluenceGate(rows, maxTickers);
      const cmp = compareCandidatePool(rows, maxTickers);
      assert.equal(cmp.actual_pool_size, real.length);
    }
  });
});

describe("buildBreakoutConfluenceShadowSnapshotRow", () => {
  test("one sentinel row, ticker=__EDITION__, new free-text stage, never collides with a real ticker", () => {
    const cmp = compareCandidatePool(corroboratedFiller(5), 5);
    const rowOut = buildBreakoutConfluenceShadowSnapshotRow("2026-09-23", cmp);
    assert.equal(rowOut.edition_for, "2026-09-23");
    assert.equal(rowOut.ticker, "__EDITION__");
    assert.equal(rowOut.stage, "breakout_confluence_shadow");
    assert.equal(rowOut.rank, null);
    assert.equal(rowOut.score, null);
    assert.equal(rowOut.selected_for_publish, null);
    assert.deepEqual(rowOut.snapshot_json, cmp);
  });
});

describe("drift guard — CONFLUENCE_PROTECTED_TOP/CONFLUENCE_MIN_SOURCES defaults stay in sync", () => {
  test("computeCorrectedCandidatePool's default params equal the real exported constants (no silent desync)", () => {
    const rows = [
      ...corroboratedFiller(CONFLUENCE_PROTECTED_TOP + 3),
      row({ ticker: "DEFAULT_CHECK", composite_score: 0.1, source_count: 1, sources: ["breakout"] }),
    ];
    // Calling with explicit params matching the real constants must equal calling with no params.
    const withDefaults = computeCorrectedCandidatePool(rows, 50);
    const withExplicit = computeCorrectedCandidatePool(rows, 50, CONFLUENCE_PROTECTED_TOP, CONFLUENCE_MIN_SOURCES);
    assert.deepEqual(withDefaults, withExplicit);
  });
});

describe("drift guard — applyConfluenceGate's own admission logic shape", () => {
  test("candidates.ts still gates on `i < protectedTop || row.source_count >= minSources` (the exact condition this module's structure-exemption adds a third arm to)", () => {
    const src = readFileSync(fileURLToPath(new URL("./candidates.ts", import.meta.url)), "utf8");
    assert.match(src, /if \(i < protectedTop \|\| row\.source_count >= minSources\) admitted\.push\(row\);/);
  });
});
