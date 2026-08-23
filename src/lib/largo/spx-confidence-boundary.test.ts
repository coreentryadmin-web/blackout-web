import test from "node:test";
import assert from "node:assert/strict";
import {
  omitUncalibratedSpxConfidence,
  SPX_CONFIDENCE_OMITTED,
} from "./spx-confidence-boundary";
import { computeSpxConfluence } from "@/features/spx/lib/spx-signals";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

test("strips confidence and names the absence", () => {
  const out = omitUncalibratedSpxConfidence({ score: 40, grade: "B", confidence: 61 }) as Record<
    string,
    unknown
  >;
  assert.ok(!("confidence" in out), "the fabricated percentage must not reach the model");
  assert.equal(out.confidence_omitted, SPX_CONFIDENCE_OMITTED);
  // The calibrated-enough structural facts stay — omission must not cost the model real signal.
  assert.equal(out.score, 40);
  assert.equal(out.grade, "B");
});

test("the reason names what to use INSTEAD — an absence with no substitute is just a blank", () => {
  for (const token of ["score", "grade", "agreeing", "weighted_conflicts"]) {
    assert.ok(
      SPX_CONFIDENCE_OMITTED.includes(token),
      `the omission reason must point at ${token}`
    );
  }
  assert.ok(/not a probability/i.test(SPX_CONFIDENCE_OMITTED));
});

test("a payload that never carried confidence is returned untouched", () => {
  const err = { error: "No confluence available — SPX desk not live yet." };
  const out = omitUncalibratedSpxConfidence(err);
  assert.deepEqual(out, err, "must not invent confidence_omitted on an unrelated shape");
  assert.equal(out, err, "same reference — no needless copy");
});

test("null, undefined, primitives and arrays pass straight through", () => {
  assert.equal(omitUncalibratedSpxConfidence(null), null);
  assert.equal(omitUncalibratedSpxConfidence(undefined), undefined);
  assert.equal(omitUncalibratedSpxConfidence(7), 7);
  const arr = [{ confidence: 1 }];
  assert.equal(omitUncalibratedSpxConfidence(arr), arr, "arrays are not payload objects");
});

test("does NOT recurse — a nested peer product's calibrated confidence survives", () => {
  // get_ecosystem_context carries Vector/Thermal/HELIX beside the SPX state. Removing a peer
  // lane's MEASURED confidence to fix ours would be the same defect in the other direction.
  const eco = {
    spx_full_state: { score: 10, confidence: 33 },
    vector_full_state: { confidence: 0.82 },
  };
  const out = omitUncalibratedSpxConfidence(eco) as Record<string, Record<string, unknown>>;
  assert.equal(out.vector_full_state.confidence, 0.82, "peer confidence untouched");
  assert.equal(
    out.spx_full_state.confidence,
    33,
    "and the nested SPX one is NOT stripped here — callers apply the helper to that object directly"
  );
});

// ── the defect this exists to stop, demonstrated on the REAL engine ─────────────────────────────
function deskWith(over: Partial<SpxDeskPayload>): SpxDeskPayload {
  return {
    available: true,
    price: 7700,
    vwap: 7700,
    gamma_flip: null,
    gamma_regime: "unknown",
    gex_walls: [],
    gex_king: null,
    strike_stacks: [],
    news_headlines: [],
    macro_events: [],
    polled_at: new Date().toISOString(),
    ...over,
  } as unknown as SpxDeskPayload;
}

test("REGRESSION: confidence is exactly |score|*1.15 + factors.length*3 — a factor COUNT, not a measurement", () => {
  // Two factors that cancel: price exactly at VWAP is not scored, so drive it with walls instead.
  const conflicted = computeSpxConfluence(
    deskWith({
      price: 7700,
      vwap: 7690, // above VWAP  -> +12
      gex_walls: [
        { strike: 7695, kind: "support", gamma: 1e9 },
        { strike: 7705, kind: "resistance", gamma: 1e9 },
      ] as unknown as SpxDeskPayload["gex_walls"],
    })
  );
  assert.ok(conflicted, "engine produced a read");
  // Whatever the exact numbers, the invariant that matters is structural: confidence is built
  // from factors.length, which counts BOTH signs, so contradiction cannot lower it on its own.
  const bumped = Math.round(Math.abs(conflicted!.score) * 1.15 + conflicted!.factors.length * 3);
  assert.equal(
    conflicted!.confidence,
    Math.min(96, Math.max(0, bumped)),
    "confidence is exactly |score|*1.15 + factors.length*3 — a factor COUNT, not a measurement"
  );
  // And the engine already computes the honest quantities it does not use here.
  assert.ok(typeof conflicted!.agreeing === "number");
  assert.ok(typeof conflicted!.weighted_conflicts === "number");

  // The boundary removes it and leaves those honest quantities in place.
  const shipped = omitUncalibratedSpxConfidence(conflicted) as Record<string, unknown>;
  assert.ok(!("confidence" in shipped));
  assert.equal(shipped.agreeing, conflicted!.agreeing);
  assert.equal(shipped.weighted_conflicts, conflicted!.weighted_conflicts);
  assert.equal(shipped.score, conflicted!.score);
});
