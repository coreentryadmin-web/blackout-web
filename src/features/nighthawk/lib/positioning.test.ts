import { before, test, mock } from "node:test";
import assert from "node:assert/strict";
import type { GexPositioning } from "@/lib/providers/gex-positioning";

// LARGO-126 / task #126 — end-to-end regression: fetchPositioningSummary's warm
// (getGexPositioning-cache-hit) path used to hardcode gex_king_strike: null with a
// "not available in the light contract" comment, even though the canonical
// GexPositioning object now computes a real value. This drives the actual
// fetchPositioningSummary() function with getGexPositioning mocked to a fixture that
// carries a non-null gex_king_strike, and asserts it survives to the returned summary.

mock.module("server-only", { namedExports: {} });

const FIXTURE_GEX_POSITIONING: GexPositioning = {
  ticker: "NVDA",
  spot: 150,
  change_pct: 1.2,
  asof: new Date().toISOString(),
  flip: 148,
  call_wall: 155,
  put_wall: 140,
  max_pain: 150,
  gex_king_strike: 152,
  net_gex: -500_000_000,
  gamma_posture: "short",
  gamma_regime_read: "short gamma below flip",
  net_vex: 10_000_000,
  vanna_posture: "positive",
  vanna_regime_read: "positive vanna",
  net_dex: null,
  dex_posture: null,
  dex_regime_read: null,
  net_charm: null,
  charm_posture: null,
  charm_regime_read: null,
  nearest_wall: { strike: 155, kind: "resistance", distance_pts: 5 },
  distance_to_flip_pct: 1.35,
  shift_summary: null,
  source: "polygon",
};

// positioning.ts imports this via the "@/lib/providers/gex-positioning" tsconfig alias,
// but mock.module() must be given the RELATIVE path here: under Node 20, tsx's alias
// resolver does not run inside mock.module()'s own specifier resolution, so a "@/..."
// specifier here crashes outright (ERR_MODULE_NOT_FOUND, resolved as a literal path
// segment under this test file's own directory) rather than just missing the mock —
// confirmed by reproducing it directly. The relative form resolves to the identical
// file and is what every other mock.module() call in this repo's test suite already uses.
let currentFixture: GexPositioning = FIXTURE_GEX_POSITIONING;

mock.module("../../../lib/providers/gex-positioning", {
  namedExports: {
    getGexPositioning: async () => currentFixture,
  },
});

let fetchPositioningSummary: typeof import("./positioning").fetchPositioningSummary;

before(async () => {
  ({ fetchPositioningSummary } = await import("./positioning"));
});

test("fetchPositioningSummary: warm getGexPositioning path surfaces the real gex_king_strike, not a hardcoded null", async () => {
  currentFixture = FIXTURE_GEX_POSITIONING;
  const summary = await fetchPositioningSummary("NVDA");
  assert.equal(summary.gex_king_strike, 152);
  assert.equal(summary.source, "polygon");
  assert.equal(summary.net_gex, -500_000_000);
});

// 2026-09-15: a null flip is not a null regime. The shared GEX regime builder
// (gex-cross-validation-core.ts's buildGexRegime) already fixed this for `gamma_posture` on
// 2026-08-20 — net_short_everywhere is a real, unambiguous short-gamma read, not missing data —
// but fetchPositioningSummary's warm path re-derived `gamma_regime` from `gammaRegime(spot, flip)`
// alone, which knows nothing about flip_reason and always says "unknown" once flip is null,
// silently re-losing the fix one layer up.
test("fetchPositioningSummary: flip null + gamma_posture 'short' (net_short_everywhere) resolves to amplification, not unknown", async () => {
  currentFixture = { ...FIXTURE_GEX_POSITIONING, flip: null, gamma_posture: "short" };
  const summary = await fetchPositioningSummary("SPY");
  assert.equal(summary.gamma_flip, null);
  assert.equal(summary.gamma_regime, "amplification");
});

test("fetchPositioningSummary: flip null + gamma_posture null (a genuine data outage, e.g. insufficient_strikes) stays unknown", async () => {
  currentFixture = { ...FIXTURE_GEX_POSITIONING, flip: null, gamma_posture: null };
  const summary = await fetchPositioningSummary("SPY");
  assert.equal(summary.gamma_flip, null);
  assert.equal(summary.gamma_regime, "unknown");
});

test("fetchPositioningSummary: flip present still uses the exact spot>flip boundary (unchanged from before this fix)", async () => {
  // spot === flip: gammaRegime's own `spot > flip` semantics say amplification at the exact
  // boundary — this must NOT shift to gamma_posture's `spot >= flip` ("long") convention.
  currentFixture = { ...FIXTURE_GEX_POSITIONING, spot: 148, flip: 148, gamma_posture: "long" };
  const summary = await fetchPositioningSummary("NVDA");
  assert.equal(summary.gamma_regime, "amplification");
});
