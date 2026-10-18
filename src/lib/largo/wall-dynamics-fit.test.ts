import { test } from "node:test";
import assert from "node:assert/strict";
import { fitWallDynamicsForModel } from "./wall-dynamics-fit";
import { VECTOR_FULL_STATE_FIXTURE } from "@/lib/bie/vector-full-state-fixture";

const TRANSPORT_CAP = 16_384;

const rows = (n: number, chars = 200) =>
  Array.from({ length: n }, (_, i) => ({ i, blob: "x".repeat(chars) }));

/** `desk` shaped like the real `summarizeSpxDesk` output — same fat enrichment tail
 *  spx-structure-fit.test.ts's fixture uses, since `fitWallDynamicsForModel` reuses that fitter. */
function oversizedDesk() {
  return {
    price: 7674.37,
    vix: 14.2,
    gamma_flip: 7640,
    gex_walls: rows(40),
    spx_flows: rows(120),
    unified_tape: rows(200),
    news_headlines: rows(30),
    macro_events: rows(20),
    sector_heat: rows(20),
    oi_changes: rows(30),
  } as Record<string, unknown>;
}

/** `intel` shaped like `SpxDeskBriefIntel` — positioning/heatmap rows, no dedicated fitter exists. */
function oversizedIntel() {
  return {
    positioning: rows(50, 300),
    prevPositioning: rows(50, 300),
    heatmap: rows(80, 300),
    nighthawk: { note: "ok" },
  };
}

test("the unfitted SPX wall-dynamics context really does blow the transport cap — the defect this module exists for", () => {
  const composed = {
    answer: "**SPX dealer walls & dynamics (live)**\n- Spot **7674** · γ-flip **7640**",
    context: { desk: oversizedDesk(), intel: oversizedIntel(), ladder: oversizedDesk().gex_walls },
  };
  assert.ok(JSON.stringify(composed).length > TRANSPORT_CAP);
});

test("fitWallDynamicsForModel (SPX branch): fits desk through the SPX structure fitter and omits the unfittable intel tail", () => {
  const composed = {
    answer: "**SPX dealer walls & dynamics (live)**\n- Spot **7674** · γ-flip **7640**",
    context: { desk: oversizedDesk(), intel: oversizedIntel(), ladder: rows(40) },
  };
  const fitted = fitWallDynamicsForModel(composed);
  assert.ok(
    JSON.stringify(fitted).length < TRANSPORT_CAP,
    `fitted payload ${JSON.stringify(fitted).length} must be under ${TRANSPORT_CAP}`
  );
  const ctx = fitted.context as Record<string, unknown>;
  assert.equal("intel" in ctx, false, "the unfittable intel tail must be omitted, not returned raw");
  assert.equal("ladder" in ctx, false, "the duplicate ladder field must be dropped, not fit twice");
  assert.ok(ctx.desk, "desk must still be present (fitted, not dropped)");
  assert.ok(ctx.intel_omitted, "the omission must be NAMED, not a silent absence");
});

test("fitWallDynamicsForModel (non-SPX branch): fits the raw Vector full state through fitVectorFullStateForModel", () => {
  const bigState = {
    ...VECTOR_FULL_STATE_FIXTURE,
    wallHistory: Array.from({ length: 60 }, (_, i) => ({
      time: 1_752_417_300 + i * 5,
      walls: { callWalls: rows(20, 100), putWalls: rows(20, 100) },
      gammaFlip: 7655.25,
      vexWalls: { callWalls: rows(20, 100), putWalls: rows(20, 100) },
      vexFlip: 7640.5,
    })),
  };
  const composed = { answer: "**NVDA dealer walls & dynamics (live Vector)**", context: bigState };
  assert.ok(
    JSON.stringify(composed).length > TRANSPORT_CAP,
    "sanity: the raw vector state must blow the cap unfit, otherwise this proves nothing"
  );
  const fitted = fitWallDynamicsForModel(composed);
  assert.ok(
    JSON.stringify(fitted).length < TRANSPORT_CAP,
    `fitted payload ${JSON.stringify(fitted).length} must be under ${TRANSPORT_CAP}`
  );
});

test("fitWallDynamicsForModel: a non-object context (or missing) passes through unchanged", () => {
  const composed = { answer: "no data", context: null };
  assert.deepEqual(fitWallDynamicsForModel(composed as never), composed);
});
