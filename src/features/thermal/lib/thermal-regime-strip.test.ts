import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildGexRegimeInterpretation,
  buildThermalRegimeStrip,
} from "./thermal-regime-strip";

describe("buildGexRegimeInterpretation", () => {
  test("long gamma above flip — stabilizing + pin + regime loss", () => {
    const read = buildGexRegimeInterpretation({
      flip: 773,
      posture: "long",
      magnetStrike: 780,
      callWall: 780,
    });
    assert.match(read!, /stabilizing above 773/);
    assert.match(read!, /780 is the dominant pin/);
    assert.match(read!, /loss of 773 changes the regime/);
  });

  test("short gamma — reclaim wording", () => {
    const read = buildGexRegimeInterpretation({
      flip: 400,
      posture: "short",
      magnetStrike: null,
      callWall: 410,
    });
    assert.match(read!, /amplifying moves below 400/);
    assert.match(read!, /reclaim of 400 changes the regime/);
  });

  test("returns null when flip or posture missing", () => {
    assert.equal(buildGexRegimeInterpretation({ flip: null, posture: "long", magnetStrike: null, callWall: null }), null);
    assert.equal(buildGexRegimeInterpretation({ flip: 400, posture: null, magnetStrike: null, callWall: null }), null);
  });
});

describe("buildThermalRegimeStrip", () => {
  test("GEX strip includes badge, net gex, walls, vol suppressed", () => {
    const model = buildThermalRegimeStrip({
      lens: "gex",
      kicker: "SPY · near-term GEX",
      spot: 777,
      flip: 773,
      callWall: 780,
      putWall: 770,
      maxPain: 763,
      netTotal: 12_300_000_000,
      magnetStrike: 780,
      gammaPosture: "long",
      netDelta: "+$412M",
      netDeltaTone: "bull",
    });
    assert.equal(model.badge?.text, "LONG GAMMA");
    assert.ok(model.segments.some((s) => s.key === "netGex" && s.value.includes("12.3B")));
    assert.ok(model.segments.some((s) => s.key === "vol" && s.value === "SUPPRESSED"));
    assert.ok(model.interpretation?.includes("dominant pin"));
  });

  test("missing posture omits vol segment and uses server read fallback", () => {
    const model = buildThermalRegimeStrip({
      lens: "gex",
      kicker: "test",
      spot: 100,
      flip: null,
      callWall: null,
      putWall: null,
      maxPain: null,
      netTotal: 0,
      magnetStrike: null,
      serverRead: "Gamma flip undetermined.",
    });
    assert.equal(model.badge, null);
    assert.equal(model.interpretation, "Gamma flip undetermined.");
    assert.ok(!model.segments.some((s) => s.key === "vol"));
  });
});
