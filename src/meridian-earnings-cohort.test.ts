import test from "node:test";
import assert from "node:assert/strict";

// Lives under src/, not beside the module it tests, ON PURPOSE: `scripts/run-tests.mjs` — the
// command CI runs — walks `src/` only, so a test placed next to an audit lib never gates anything.
// Same reason `src/audit-tunnel-streaming.test.ts` and `src/lib/largo/payload-hygiene.test.ts`
// reach across the boundary rather than sitting in `scripts/audit/lib/`.

import {
  EARNINGS_ROW_BASE,
  describeCohort,
  earningsRowSelector,
  normalizeMinImpact,
  splitAuthFailures,
} from "../scripts/audit/lib/meridian-earnings-cohort.mjs";

/**
 * A UI VERDICT WITHOUT ITS COHORT IS NOT A FACT ABOUT THE PANEL.
 *
 * Both live Meridian UI harnesses clicked the FIRST earnings row on the timeline — whichever
 * ticker was next by date. Live 2026-08-21 that was `TP`, a low-impact micro-cap with
 * `thermal.available: false` and no options market, so `expected_move_band` was null,
 * `MeridianMoveRail` correctly rendered nothing, and `.mv-rail-track` was absent. The earnings-UI
 * audit reported the Positioning tab **RED on all three viewports** for a panel behaving exactly
 * as designed. On BABA in the same session the rail paints.
 *
 * The guard did not merely delete false REDs — it made the interaction audit reach a populated
 * panel for the first time, where it immediately measured real overlaps
 * (`"King node" ∩ "Gamma flip" 74x4px`) that an empty micro-cap panel could never have exposed.
 */
test("high is the default, and an unrecognised value falls back to it rather than widening", () => {
  assert.equal(normalizeMinImpact(undefined), "high");
  assert.equal(normalizeMinImpact(null), "high");
  assert.equal(normalizeMinImpact(""), "high");
  assert.equal(normalizeMinImpact("nonsense"), "high");
  assert.equal(normalizeMinImpact("HIGH"), "high");
  assert.match(earningsRowSelector("high"), /:has\(\.impact-high\)/);
});

test("medium admits high AND medium — a floor, not an exact tier", () => {
  const sel = earningsRowSelector("medium");
  assert.match(sel, /impact-high/);
  assert.match(sel, /impact-medium/);
});

test("low means EVERY row, never only the low tier", () => {
  // "At least low" is every row. Matching `.impact-low` alone would invert the flag's meaning and
  // reintroduce exactly the micro-cap-only sampling the guard exists to stop.
  assert.equal(earningsRowSelector("low"), EARNINGS_ROW_BASE);
  assert.ok(!earningsRowSelector("low").includes("impact-low"));
});

test("the selector always stays scoped to EARNINGS rows", () => {
  // The timeline mixes macro/FDA/OpEx rows, which have no earnings tabs at all.
  for (const tier of ["high", "medium", "low"]) {
    assert.ok(
      earningsRowSelector(tier).includes("meridian-theme-earnings"),
      `${tier} must not widen past earnings rows`
    );
  }
});

test("describeCohort names the cohort every result line has to carry", () => {
  assert.equal(describeCohort("high"), "impact>=high");
  assert.equal(describeCohort("medium"), "impact>=medium");
  assert.equal(describeCohort(undefined), "impact>=high");
});

test("401/403 are separated from real failures — a lost session is not a product defect", () => {
  // A run can outlive its ~72s JWT. CLAUDE.md records this being mis-read as a PRODUCT fault
  // three times (thermal validator sectors, force-rebuild "IWM 0/5", the Vector board poll).
  const { auth, failures } = splitAuthFailures([
    "401 https://x/api/market/meridian/timeline",
    "500 https://x/api/market/a",
    "403 https://x/api/market/b",
    "404 https://x/static/c",
  ]);
  assert.equal(auth.length, 2);
  assert.equal(failures.length, 2);
  assert.ok(failures.every((f) => !/^(401|403)\b/.test(f)));
});

test("a status merely CONTAINING 401 is not treated as auth", () => {
  // Anchored match: a 500 whose URL happens to contain "401" is a real failure.
  const { auth, failures } = splitAuthFailures(["500 https://x/api/thing?id=401"]);
  assert.equal(auth.length, 0);
  assert.equal(failures.length, 1);
});

test("empty and missing input are safe", () => {
  assert.deepEqual(splitAuthFailures(undefined), { auth: [], failures: [] });
  assert.deepEqual(splitAuthFailures([]), { auth: [], failures: [] });
});
