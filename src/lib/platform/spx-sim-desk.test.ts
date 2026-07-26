import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  shouldServeSpxSim,
  isSpxSimRequested,
  isSpxSimDeskBundle,
  emptySpxSimSnapshot,
  SPX_SIM_SNAPSHOT_KEY,
  SPX_SIM_TTL_SEC,
} from "./spx-sim-desk";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── THE gate: {isAdmin, simRequested} → serve sim? ──────────────────────────────────
// The safety-critical truth table. Sim data reaches a browser ONLY on the one admin+sim
// combination; every other combination MUST fall through to the member path.
test("shouldServeSpxSim: sim served ONLY for admin AND sim=1", () => {
  assert.equal(shouldServeSpxSim(true, true), true, "admin + sim=1 → sim");
  assert.equal(shouldServeSpxSim(false, true), false, "non-admin + sim=1 → member (never sim)");
  assert.equal(shouldServeSpxSim(true, false), false, "admin + no sim → member");
  assert.equal(shouldServeSpxSim(false, false), false, "non-admin + no sim → member");
});

test("isSpxSimRequested opts in ONLY on the exact ?sim=1 value", () => {
  assert.equal(isSpxSimRequested("1"), true);
  assert.equal(isSpxSimRequested(null), false);
  assert.equal(isSpxSimRequested(undefined), false);
  assert.equal(isSpxSimRequested("0"), false);
  assert.equal(isSpxSimRequested("true"), false);
  assert.equal(isSpxSimRequested("2"), false);
  assert.equal(isSpxSimRequested(""), false);
});

// Composed gate exactly as each route uses it — a non-admin passing ?sim=1 never gets sim.
test("composed gate: non-admin can never reach sim regardless of param", () => {
  for (const param of ["1", "0", "true", null, undefined, "", "yes"]) {
    assert.equal(shouldServeSpxSim(false, isSpxSimRequested(param)), false);
  }
  assert.equal(shouldServeSpxSim(true, isSpxSimRequested("1")), true);
  assert.equal(shouldServeSpxSim(true, isSpxSimRequested("0")), false);
});

// ── Bundle validation — malformed frames are rejected before any write ──────────────
test("isSpxSimDeskBundle accepts the empty bundle and partial/full frames", () => {
  assert.equal(isSpxSimDeskBundle(emptySpxSimSnapshot()), true);
  assert.equal(isSpxSimDeskBundle({}), true, "empty {} is a valid (unseeded) bundle");
  assert.equal(isSpxSimDeskBundle({ desk: { available: true, price: 6300 } }), true);
  assert.equal(
    isSpxSimDeskBundle({
      bootstrap: { desk: {}, flow: null, pulse: null, merged: {}, gexHeatmap: null },
      desk: {},
      pulse: {},
      flow: {},
      play: { action: "BUY" },
      pin: {},
      gexHeatmap: { available: true, strikes: [] },
    }),
    true
  );
});

test("isSpxSimDeskBundle rejects non-objects and array/non-object lanes", () => {
  assert.equal(isSpxSimDeskBundle(null), false);
  assert.equal(isSpxSimDeskBundle(undefined), false);
  assert.equal(isSpxSimDeskBundle("nope"), false);
  assert.equal(isSpxSimDeskBundle(42), false);
  assert.equal(isSpxSimDeskBundle([]), false, "a top-level array is not a bundle");
  assert.equal(isSpxSimDeskBundle({ desk: "x" }), false, "a lane must be an object");
  assert.equal(isSpxSimDeskBundle({ desk: [] }), false, "a lane must not be an array");
  assert.equal(isSpxSimDeskBundle({ play: 3 }), false, "a lane must be an object");
  // An absent lane (undefined) is allowed — partial frames are valid.
  assert.equal(isSpxSimDeskBundle({ desk: undefined, pulse: { available: true } }), true);
});

test("emptySpxSimSnapshot is an empty object (no lanes seeded)", () => {
  assert.deepEqual(emptySpxSimSnapshot(), {});
});

// ── Isolation invariants ────────────────────────────────────────────────────────────
test("sim key is isolated from every live SPX cache lane", () => {
  assert.equal(SPX_SIM_SNAPSHOT_KEY, "spx:desk:snapshot:sim:v1");
  assert.ok(SPX_SIM_SNAPSHOT_KEY.includes(":sim:"), "the :sim: segment is the isolation boundary");
  // The sim module must not reference any live SPX cache-key literal.
  const src = readFileSync(join(ROOT, "lib/platform/spx-sim-desk.ts"), "utf8");
  for (const liveKey of ['"spx-desk:', '"spx-desk-pulse:', '"spx-desk-flow:', '"spx-pin:', '"spx-bootstrap:']) {
    assert.equal(src.includes(liveKey), false, `sim module must not reference the live key ${liveKey}`);
  }
});

test("sim TTL is short (self-expiring) and at least a minute", () => {
  assert.ok(SPX_SIM_TTL_SEC >= 60, "TTL floor");
  assert.ok(SPX_SIM_TTL_SEC <= 60 * 60, "TTL should be short (<= 1h) so abandoned sims self-expire");
});

// ── Route-level isolation proofs (read the shipped source) ─────────────────────────
// For each of the 7 read routes: the LIVE reader is still present (so the member path is
// reached unchanged) AND the sim branch is gated on admin + ?sim=1.
const ROUTE_LIVE_READER: Array<[string, string]> = [
  ["app/api/market/spx/bootstrap/route.ts", "loadBootstrapBundle"],
  ["app/api/market/spx/desk/route.ts", "loadSpxDesk"],
  ["app/api/market/spx/pulse/route.ts", "loadSpxDeskPulse"],
  ["app/api/market/spx/flow/route.ts", "loadSpxDeskFlow"],
  ["app/api/market/spx/play/route.ts", "getSpxPlayState"],
  ["app/api/market/spx/pin/route.ts", "loadSpxPinForecast"],
  ["app/api/market/gex-heatmap/route.ts", "fetchGexHeatmap"],
];

for (const [file, liveReader] of ROUTE_LIVE_READER) {
  test(`${file}: live reader present AND sim branch gated on admin + ?sim=1`, () => {
    const route = readFileSync(join(ROOT, file), "utf8");
    assert.match(route, new RegExp(`${liveReader}\\(`), `live reader ${liveReader} must still be called`);
    assert.match(route, /shouldServeSpxSim/, "sim branch must go through the pure gate");
    assert.match(route, /isSpxSimRequested/, "sim branch must check the ?sim=1 opt-in");
    assert.match(route, /isAdminUser/, "sim branch must verify admin");
    assert.match(route, /getSpxSimSnapshot/, "sim branch reads the isolated sim snapshot");
    assert.match(route, /"X-Spx-Sim": "1"/, "sim response carries the X-Spx-Sim marker");
  });
}

test("gex-heatmap sim branch is SPX-only", () => {
  const route = readFileSync(join(ROOT, "app/api/market/gex-heatmap/route.ts"), "utf8");
  // The sim branch condition must require ticker === "SPX" so non-SPX matrices never sim.
  assert.match(route, /ticker === "SPX" &&\s*[\s\S]*?isSpxSimRequested/);
});

test("ingest endpoint is admin-gated and writes ONLY the sim key", () => {
  const route = readFileSync(join(ROOT, "app/api/admin/spx/sim/desk/route.ts"), "utf8");
  assert.match(route, /requireAdminApi/);
  assert.match(route, /writeSpxSimSnapshot/);
  assert.match(route, /clearSpxSimSnapshot/);
  assert.match(route, /isSpxSimDeskBundle/);
  // The ingest endpoint must never call any live SPX writer/reader.
  assert.doesNotMatch(route, /loadSpxDesk|loadBootstrapBundle|getSpxPlayState|buildSpxDesk/);
});
