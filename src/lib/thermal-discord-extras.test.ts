import assert from "node:assert/strict";
import test from "node:test";
import { buildThermalShiftLeadersLine } from "./thermal-discord-extras.ts";
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
