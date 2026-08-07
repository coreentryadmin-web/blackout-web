import { test } from "node:test";
import assert from "node:assert/strict";
import type { NighthawkPlayOutcomeRow } from "@/lib/db";
import { buildRecordSegment } from "./analytics";

// P3 2026-08-07: the record's own exclusion breakdown could not be reconciled.
// GET /api/market/nighthawk/record?days=30 →
//   resolved 50, scoreable 27, unfilled 13, pulled 12, stop_data_unavailable 0
//   27 + 13 + 12 + 0 = 52  vs  resolved 50   → overshoot 2
// The rates were never wrong; `unfilled` and `pulled` are independently computed and OVERLAP.

function row(over: Partial<NighthawkPlayOutcomeRow>): NighthawkPlayOutcomeRow {
  return {
    id: 1, ticker: "TEST", direction: "LONG", outcome: "target",
    return_pct: 1, pulled: false, edition_for: "2026-08-01",
    ...over,
  } as NighthawkPlayOutcomeRow;
}

/** The live shape: 50 resolved = 27 scoreable + 13 unfilled + 12 pulled, with 2 in BOTH. */
function liveShape(): NighthawkPlayOutcomeRow[] {
  const rows: NighthawkPlayOutcomeRow[] = [];
  for (let i = 0; i < 27; i++) rows.push(row({ id: i, outcome: i < 2 ? "stop" : "open" }));
  for (let i = 0; i < 11; i++) rows.push(row({ id: 100 + i, outcome: "unfilled" }));           // unfilled only
  for (let i = 0; i < 10; i++) rows.push(row({ id: 200 + i, outcome: "target", pulled: true })); // pulled only
  for (let i = 0; i < 2; i++) rows.push(row({ id: 300 + i, outcome: "unfilled", pulled: true })); // BOTH
  return rows;
}

test("REGRESSION: the live 2026-08-07 shape reproduces the un-summable breakdown", () => {
  const seg = buildRecordSegment("v2_fillability", liveShape());
  assert.equal(seg.resolved, 50);
  assert.equal(seg.scoreable, 27);
  assert.equal(seg.unfilled, 13);
  assert.equal(seg.pulled, 12);
  // The defect, pinned: the naive sum overshoots by exactly the overlap.
  assert.equal(seg.scoreable + seg.unfilled + seg.pulled, 52);
  assert.equal(seg.scoreable + seg.unfilled + seg.pulled - seg.resolved, 2, "overshoot == |overlap|");
});

test("excluded_total makes the breakdown reconcile: scoreable + excluded_total === resolved", () => {
  const seg = buildRecordSegment("v2_fillability", liveShape());
  assert.equal(seg.excluded_total, 23);
  assert.equal(seg.scoreable + seg.excluded_total, seg.resolved);
});

test("unfilled_not_pulled + pulled is the DISJOINT partition of the excluded set", () => {
  const seg = buildRecordSegment("v2_fillability", liveShape());
  assert.equal(seg.unfilled_not_pulled, 11, "13 unfilled minus the 2 that were also pulled");
  assert.equal(seg.unfilled_not_pulled + seg.pulled + seg.stop_data_unavailable, seg.excluded_total);
});

test("the invariant holds with NO overlap too — this is not a hardcoded offset", () => {
  const rows = [
    ...Array.from({ length: 5 }, (_, i) => row({ id: i, outcome: "target" })),
    ...Array.from({ length: 3 }, (_, i) => row({ id: 100 + i, outcome: "unfilled" })),
    ...Array.from({ length: 2 }, (_, i) => row({ id: 200 + i, outcome: "target", pulled: true })),
  ];
  const seg = buildRecordSegment("v2_fillability", rows);
  assert.equal(seg.excluded_total, 5);
  assert.equal(seg.unfilled_not_pulled, 3);
  assert.equal(seg.scoreable + seg.excluded_total, seg.resolved);
  assert.equal(seg.unfilled_not_pulled + seg.pulled, seg.excluded_total);
});

test("no RATE changed — the exclusion logic was always correct, only the reporting was ambiguous", () => {
  const seg = buildRecordSegment("v2_fillability", liveShape());
  // Core invariant the audit confirmed already held: wins+losses+opens+ambiguous === scoreable.
  assert.equal(seg.wins + seg.losses + seg.opens + seg.ambiguous, seg.scoreable);
  assert.equal(seg.decided, seg.wins + seg.losses);
  assert.equal(seg.win_rate, seg.decided > 0 ? seg.wins / seg.decided : null);
});

test("an empty segment stays coherent rather than producing NaN", () => {
  const seg = buildRecordSegment("v2_fillability", []);
  assert.equal(seg.resolved, 0);
  assert.equal(seg.excluded_total, 0);
  assert.equal(seg.unfilled_not_pulled, 0);
  assert.equal(seg.win_rate, null);
});
