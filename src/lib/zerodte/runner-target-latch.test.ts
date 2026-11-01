import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePlayStatus } from "./plan";

test("derivePlayStatus: 300% frozen target does not TRIM at +120% peak", () => {
  const entry = 1.0;
  const peak = 2.2; // +120%
  const s = derivePlayStatus({
    entryPremium: entry,
    mark: 2.1,
    peak,
    trough: 0.9,
    nowEtMinutes: 12 * 60,
    targetPct: 300,
  });
  assert.equal(s.status, "HOLD");
});

test("derivePlayStatus: default +100% target still TRIMs at double", () => {
  const entry = 1.0;
  const s = derivePlayStatus({
    entryPremium: entry,
    mark: 2.0,
    peak: 2.0,
    trough: 0.9,
    nowEtMinutes: 12 * 60,
  });
  assert.equal(s.status, "TRIM");
});

// ── 2026-09-09 finding: trim_scale badge lag ──────────────────────────────────────────
// A trim_scale (A/B-tier) row's REAL first partial bank fires at a peak far below the
// ratchet's +100% `targetPct` literal (TRIM_SCALE_RULES.tranches_by_regime — +20% for
// neutral). Before this fix, `derivePlayStatus` had no way to know that: it only ever
// compared peak against `targetPct`, so a trim_scale row that had genuinely banked a
// real tranche via the exit engine still showed OPEN/HOLD on the member-facing badge
// all the way from +20% to just under +100% peak.

test("derivePlayStatus: a trim_scale row's badge stays HOLD/OPEN below its OWN first-tranche threshold, exactly like before this fix", () => {
  const entry = 4.0;
  // Peak +19% — just under the neutral regime's +20% first tranche AND far under the
  // ratchet's +100% target. Neither trigger has fired; the row genuinely hasn't banked
  // anything yet, so the badge must not claim otherwise.
  const s = derivePlayStatus({
    entryPremium: entry,
    mark: 4.6,
    peak: 4.76, // +19%
    trough: 4.6,
    nowEtMinutes: 12 * 60,
    trimScaleFirstTranchePct: 20, // neutral regime's own first tranche
  });
  assert.notEqual(s.status, "TRIM");
});

test("derivePlayStatus: a trim_scale row's badge flips to TRIM at ITS OWN first-tranche threshold (+20% neutral) — THE BADGE-LAG FIX — not the ratchet's +100% literal", () => {
  const entry = 4.0;
  // Peak +22% (a real live shape from the 2026-09-09 finding's trace) — well past the
  // trim_scale row's own first tranche, far below the ratchet's +100% target. Before
  // this fix, `derivePlayStatus` had no `trimScaleFirstTranchePct` param at all: this
  // exact input would have returned "HOLD" here (peak 4.88 < target 8.0), lagging the
  // exit engine's own already-real partial bank by ~80 percentage points of peak.
  const s = derivePlayStatus({
    entryPremium: entry,
    mark: 4.5,
    peak: 4.88, // +22%
    trough: 4.5,
    nowEtMinutes: 12 * 60,
    trimScaleFirstTranchePct: 20,
  });
  assert.equal(s.status, "TRIM");
});

test("derivePlayStatus: trimScaleFirstTranchePct omitted (ratchet rows, and any legacy/untiered caller) is BYTE-IDENTICAL to the pre-fix ratchet behavior", () => {
  const entry = 4.0;
  // Same +22% peak as the trim_scale test above, but no trimScaleFirstTranchePct —
  // exactly what a ratchet-mode row (or a legacy row with no identifiable exit-policy
  // pin) passes. Must fall back to `targetPct` (default +100%) — HOLD here, unchanged.
  const s = derivePlayStatus({
    entryPremium: entry,
    mark: 4.5,
    peak: 4.88, // +22%
    trough: 4.5,
    nowEtMinutes: 12 * 60,
  });
  assert.notEqual(s.status, "TRIM");
});
