import { test } from "node:test";
import assert from "node:assert/strict";
import {
  syntheticSpxFrames,
  buildBundleAt,
  buildPlayFrame,
  buildGexHeatmapFrame,
  isValidSpxSimBundle,
  spotAt,
  GAMMA_FLIP,
  CALL_WALL,
  PUT_WALL,
  RTH_OPEN_ET,
  RTH_LAST_ET,
} from "./spx-sim-frames.mjs";

test("syntheticSpxFrames spans RTH on a 5-minute grid and every frame is a valid bundle", () => {
  const frames = syntheticSpxFrames();
  assert.ok(frames.length > 70, "≈78 five-minute frames across the session");
  assert.equal(frames[0].etMinute, RTH_OPEN_ET);
  assert.equal(frames[frames.length - 1].etMinute, RTH_LAST_ET);
  for (const f of frames) {
    assert.equal(isValidSpxSimBundle(f.payload), true, `frame ${f.etMinute} must satisfy the ingest contract`);
    // Every lane the routes serve is present so the whole desk lights up.
    for (const lane of ["bootstrap", "desk", "pulse", "flow", "play", "pin", "gexHeatmap"]) {
      assert.ok(f.payload[lane], `frame ${f.etMinute} carries the ${lane} lane`);
    }
  }
});

test("spot marches up through the gamma flip (a gamma-flip cross)", () => {
  // Opens below the flip, ends above it — the regime crosses at least once.
  assert.ok(spotAt(RTH_OPEN_ET) < GAMMA_FLIP, "opens below the flip (short gamma)");
  assert.ok(spotAt(720) > GAMMA_FLIP, "midday spot above the flip (long gamma)");
  const regimes = new Set(
    syntheticSpxFrames().map((f) => f.payload.gexHeatmap.gex.regime)
  );
  assert.ok(regimes.has("short_gamma") && regimes.has("long_gamma"), "both regimes appear across the arc");
});

test("gex matrix carries call/put walls and a full strike ladder with cells", () => {
  const g = buildGexHeatmapFrame(720);
  assert.equal(g.available, true);
  assert.equal(g.gex.call_wall, CALL_WALL);
  assert.equal(g.gex.put_wall, PUT_WALL);
  assert.equal(g.gex.flip, GAMMA_FLIP);
  assert.ok(g.strikes.length >= 20, "a real ladder, not a stub");
  assert.ok(g.expiries.length >= 3, "multi-expiry columns");
  // The call wall really is the argmax positive strike-total, the put wall the argmax negative.
  const totals = g.gex.strike_totals;
  const maxPosStrike = Object.keys(totals).reduce((a, b) => (totals[b] > totals[a] ? b : a));
  const maxNegStrike = Object.keys(totals).reduce((a, b) => (totals[b] < totals[a] ? b : a));
  assert.equal(Number(maxPosStrike), CALL_WALL, "call wall = largest positive net gamma strike");
  assert.equal(Number(maxNegStrike), PUT_WALL, "put wall = largest negative net gamma strike");
});

test("play runs the full lifecycle across the session", () => {
  const actions = [];
  for (let m = RTH_OPEN_ET; m <= RTH_LAST_ET; m += 5) actions.push(buildPlayFrame(m).action);
  const seen = new Set(actions);
  // SCANNING → WATCHING → armed BUY → OPEN/managed (HOLD/TRIM) → CLOSED (back to SCANNING).
  for (const a of ["SCANNING", "WATCHING", "BUY", "HOLD", "TRIM", "SELL"]) {
    assert.ok(seen.has(a), `lifecycle reaches ${a}`);
  }
  // Pre-open is SCANNING; a committed BUY appears; late session resolves and returns to SCANNING.
  assert.equal(buildPlayFrame(RTH_OPEN_ET).action, "SCANNING");
  assert.equal(buildPlayFrame(RTH_OPEN_ET).open_play, null);
  const armed = buildPlayFrame(622);
  assert.equal(armed.action, "BUY");
  assert.equal(armed.signal_committed, true);
  assert.ok(armed.open_play && armed.open_play.entry_price > 0, "committed BUY carries an open_play");
});

test("buildBundleAt bootstrap mirrors the desk + matrix lanes", () => {
  const b = buildBundleAt(660);
  assert.equal(b.bootstrap.desk.price, b.desk.price);
  assert.equal(b.bootstrap.gexHeatmap.spot, b.gexHeatmap.spot);
  assert.equal(b.bootstrap.merged.price, b.desk.price);
});
