import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeGreekExposureByExpiry } from "./greek-exposure-summary";

test("summarizeGreekExposureByExpiry: picks the earlier expiry deterministically on an exact gamma tie", () => {
  // Two expiries with an IDENTICAL net_gamma — a genuine 50/50 split — differing only in which
  // row the upstream UW greek-exposure/expiry payload happened to list first. The two inputs
  // below describe the SAME market state; only row order differs.
  const rowsLaterFirst = [
    { expiry: "2026-01-02", net_gamma: 1_000_000 },
    { expiry: "2026-01-01", net_gamma: 1_000_000 },
  ];
  const rowsEarlierFirst = [
    { expiry: "2026-01-01", net_gamma: 1_000_000 },
    { expiry: "2026-01-02", net_gamma: 1_000_000 },
  ];

  const a = summarizeGreekExposureByExpiry(rowsLaterFirst, "2026-01-05");
  const b = summarizeGreekExposureByExpiry(rowsEarlierFirst, "2026-01-05");

  assert.ok(a && b, "both summaries should resolve");
  // Row order must never decide which equally-weighted expiry is reported as pinned.
  assert.equal(a!.pinned_expiry, b!.pinned_expiry);
  assert.equal(a!.headline, b!.headline);
  // Earlier (nearer) expiry wins the tie, matching the sibling argmax tie-break fixes
  // (gex-wall-levels.ts, strike-gex-lookup.ts, meridian-gex-reads.ts).
  assert.equal(a!.pinned_expiry, "2026-01-01");
});

test("summarizeGreekExposureByExpiry: a real winner (no tie) still wins regardless of row order", () => {
  const rows = [
    { expiry: "2026-01-02", net_gamma: 4_000_000 },
    { expiry: "2026-01-01", net_gamma: 1_000_000 },
  ];
  const reordered = [
    { expiry: "2026-01-01", net_gamma: 1_000_000 },
    { expiry: "2026-01-02", net_gamma: 4_000_000 },
  ];

  const a = summarizeGreekExposureByExpiry(rows, "2026-01-05");
  const b = summarizeGreekExposureByExpiry(reordered, "2026-01-05");

  assert.equal(a!.pinned_expiry, "2026-01-02");
  assert.equal(b!.pinned_expiry, "2026-01-02");
});

test("summarizeGreekExposureByExpiry: 0DTE labeling and headline still work for today's expiry", () => {
  const rows = [
    { expiry: "2026-01-05", net_gamma: 2_000_000 },
    { expiry: "2026-01-06", net_gamma: 500_000 },
  ];
  const s = summarizeGreekExposureByExpiry(rows, "2026-01-05");
  assert.equal(s!.pinned_expiry, "2026-01-05");
  assert.match(s!.headline, /^0DTE is \d+% of dealer gamma today$/);
});
