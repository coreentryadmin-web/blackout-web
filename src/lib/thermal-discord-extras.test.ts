import assert from "node:assert/strict";
import test from "node:test";
import { buildThermalShiftLeadersLine, fmtShiftPct } from "./thermal-discord-extras.ts";
import type { ThermalCardColumn } from "./thermal-discord-card.ts";

function col(opts: {
  strikeTotals: Record<string, number>;
  deltaByStrike: Record<string, number>;
}): ThermalCardColumn {
  return {
    ticker: "SPY",
    heatmap: {
      spot: 700,
      asof: "2026-08-05T14:00:00.000Z",
      gex: { strike_totals: opts.strikeTotals },
      shift: { available: true, delta_by_strike: opts.deltaByStrike },
    } as ThermalCardColumn["heatmap"],
  };
}

test("buildThermalShiftLeadersLine — a strengthening (building) put wall reads build, not melt", () => {
  // Put wall at 95: baseline -700,000 -> current -900,000 (delta -200,000). The wall's magnitude
  // GREW (700k -> 900k, +28.6%), i.e. it BUILT — even though the raw signed delta is negative.
  const line = buildThermalShiftLeadersLine(
    col({ strikeTotals: { "95": -900_000 }, deltaByStrike: { "95": -200_000 } }),
    1
  );
  assert.ok(line, "expected a shift line");
  assert.match(line!, /build/);
  assert.doesNotMatch(line!, /melt/);
  // Correct magnitude-based % is +29%, not the raw-delta-derived -29%.
  assert.match(line!, /\+29%/);
});

test("buildThermalShiftLeadersLine — a decaying (melting) put wall reads melt, not build", () => {
  // Put wall at 95: baseline -900,000 -> current -700,000 (delta +200,000). The wall's magnitude
  // SHRANK (900k -> 700k, -22.2%), i.e. it MELTED — even though the raw signed delta is positive.
  const line = buildThermalShiftLeadersLine(
    col({ strikeTotals: { "95": -700_000 }, deltaByStrike: { "95": 200_000 } }),
    1
  );
  assert.ok(line, "expected a shift line");
  assert.match(line!, /melt/);
  assert.doesNotMatch(line!, /build/);
  assert.match(line!, /-22%/);
});

test("buildThermalShiftLeadersLine — call wall build/melt is unaffected (same sign both conventions)", () => {
  // Call wall at 105: baseline 700,000 -> current 900,000 (delta +200,000) — builds either way.
  const line = buildThermalShiftLeadersLine(
    col({ strikeTotals: { "105": 900_000 }, deltaByStrike: { "105": 200_000 } }),
    1
  );
  assert.ok(line, "expected a shift line");
  assert.match(line!, /build/);
  assert.match(line!, /\+29%/);
});

// ── fmtShiftPct: sign-biased rounding-tie bug ──────────────────────────────────────
//
// BUG: plain `Math.round(pct)` ties toward +Infinity (`Math.round(-2.5) === -2` but
// `Math.round(2.5) === 3`), so a melting strike sitting exactly on a whole-percent tie rounds to a
// SMALLER magnitude than the identical-magnitude building strike's mirror value — the same
// sign-biased rounding asymmetry already fixed in `fmt-money.ts`'s `fmtPct` (2026-10-26) and in
// this exact Thermal-desk sibling `shift-math.ts`'s `fmtShiftPercentForStrike` (whose own doc
// comment names this file's `fmtShiftPct` as the one caller still missed).

test("fmtShiftPct rounds ties by MAGNITUDE, then reapplies sign — equal-magnitude opposite shifts match", () => {
  // +2.5 is a real tie: Math.round(2.5) === 3 already, so the positive side was never broken.
  assert.equal(fmtShiftPct(2.5), "+3%");
  // Mirror: -2.5. Before the fix this rendered "-2%" (a smaller magnitude than the +3% mirror
  // above) because `Math.round(-2.5)` is -2, not -3.
  assert.equal(fmtShiftPct(-2.5), "-3%");
});

test("fmtShiftPct: a magnitude that rounds to exactly 0 reads \"0%\", never a misleading signed zero", () => {
  assert.equal(fmtShiftPct(-0.3), "0%");
  assert.equal(fmtShiftPct(0), "0%");
});

test("fmtShiftPct: null/non-finite render the honest em-dash", () => {
  assert.equal(fmtShiftPct(null), "—");
  assert.equal(fmtShiftPct(Number.NaN), "—");
});

test("buildThermalShiftLeadersLine — mirror-magnitude build/melt ties render equal magnitudes", () => {
  // Call wall at 105: baseline 1,000,000 -> current 1,025,000 (delta +25,000): pct = +2.5 exactly,
  // a real tie — builds, and was never broken (Math.round(2.5) === 3 already).
  const buildLine = buildThermalShiftLeadersLine(
    col({ strikeTotals: { "105": 1_025_000 }, deltaByStrike: { "105": 25_000 } }),
    1
  );
  assert.ok(buildLine, "expected a shift line");
  assert.match(buildLine!, /\+3%/);

  // Put wall at 95: baseline -1,000,000 -> current -975,000 (delta +25,000). Magnitude SHRANK
  // (1,000,000 -> 975,000, -2.5% exactly) — melts, with the identical tie magnitude as the build
  // above. Before the fix this rendered "-2%" (a smaller magnitude than the mirror "+3%").
  const meltLine = buildThermalShiftLeadersLine(
    col({ strikeTotals: { "95": -975_000 }, deltaByStrike: { "95": 25_000 } }),
    1
  );
  assert.ok(meltLine, "expected a shift line");
  assert.match(meltLine!, /melt/);
  assert.match(meltLine!, /-3%/);
});
