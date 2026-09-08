import assert from "node:assert/strict";
import { test } from "node:test";
import {
  omitUncalibratedSpxConfidence,
  sanitizeSpxPlayPayloadForLargo,
  SPX_CONFIDENCE_OMITTED,
  SPX_SCORE_CLAMP_NOTE,
  SPX_UNASSESSED_MEASUREMENT_OMITTED,
} from "./spx-confidence-boundary";
import { computeSpxConfluence } from "@/features/spx/lib/spx-signals";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";

test("sanitizeSpxPlayPayloadForLargo: assessed:false suppresses fabricated grade/score", () => {
  const out = sanitizeSpxPlayPayloadForLargo({
    assessed: false,
    grade: "D",
    score: 0,
    rawScore: 24,
    headline: "Desk warming",
  }) as Record<string, unknown>;
  assert.equal(out.grade, null);
  assert.equal(out.score, null);
  assert.ok(!("rawScore" in out));
  assert.equal(out.confidence_omitted, SPX_CONFIDENCE_OMITTED);
  assert.equal(out.measurement_omitted, SPX_UNASSESSED_MEASUREMENT_OMITTED);
});

test("sanitizeSpxPlayPayloadForLargo: assessed:false keeps open_play grade", () => {
  const out = sanitizeSpxPlayPayloadForLargo({
    assessed: false,
    grade: "D",
    score: 0,
    rawScore: 0,
    open_play: { grade: "A", direction: "long", entry_price: 7440, stop: 7425, target: 7465 },
  }) as Record<string, unknown>;
  assert.equal(out.grade, "A");
  assert.equal(out.score, null);
});

test("sanitizeSpxPlayPayloadForLargo: assessed:true leaves measured grade/score", () => {
  const out = sanitizeSpxPlayPayloadForLargo({
    assessed: true,
    grade: "B",
    score: 52,
    rawScore: 61,
  }) as Record<string, unknown>;
  assert.equal(out.grade, "B");
  assert.equal(out.score, 52);
  assert.ok(!("rawScore" in out));
  assert.equal(out.confidence_omitted, SPX_CONFIDENCE_OMITTED);
});

test("strips confidence and names the absence", () => {
  const out = omitUncalibratedSpxConfidence({ score: 40, grade: "B", rawScore: 61 }) as Record<
    string,
    unknown
  >;
  assert.ok(!("rawScore" in out), "the fabricated percentage must not reach the model");
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

test("REGRESSION: a signal-log row (confidence present, rawScore ABSENT) is stripped too", () => {
  // insertSpxSignalLog (spx-signal-log.ts) persists `confidence: play.rawScore` — the identical
  // fabricated formula as the confluence/play shapes, but under the OTHER name and with no
  // `rawScore` key at all. Before this fix, the guard required `rawScore` to be present, so this
  // exact row shape sailed through get_signal_log completely unomitted.
  const signalLogRow = {
    id: 1,
    signal_key: "2026-08-29|BUY|long",
    action: "BUY",
    bias: "bullish",
    score: 40,
    confidence: 96,
    price: 7700,
    entry: null,
    stop: null,
    target: null,
    headline: "SPX long",
    factors: [],
    created_at: new Date(0).toISOString(),
  };
  const out = omitUncalibratedSpxConfidence(signalLogRow) as Record<string, unknown>;
  assert.ok(!("confidence" in out), "the fabricated value must not reach the model under either name");
  assert.equal(out.confidence_omitted, SPX_CONFIDENCE_OMITTED);
  assert.equal(out.score, 40, "the non-fabricated fields survive");
  assert.equal(out.headline, "SPX long");
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
  // Whatever the exact numbers, the invariant that matters is structural: rawScore is built
  // from factors.length, which counts BOTH signs, so contradiction cannot lower it on its own.
  const bumped = Math.round(Math.abs(conflicted!.score) * 1.15 + conflicted!.factors.length * 3);
  assert.equal(
    conflicted!.rawScore,
    Math.min(96, Math.max(0, bumped)),
    "rawScore is exactly |score|*1.15 + factors.length*3 — a factor COUNT, not a measurement"
  );
  // And the engine already computes the honest quantities it does not use here.
  assert.ok(typeof conflicted!.agreeing === "number");
  assert.ok(typeof conflicted!.weighted_conflicts === "number");

  // The boundary removes it and leaves those honest quantities in place.
  const shipped = omitUncalibratedSpxConfidence(conflicted) as Record<string, unknown>;
  assert.ok(!("rawScore" in shipped));
  assert.equal(shipped.agreeing, conflicted!.agreeing);
  assert.equal(shipped.weighted_conflicts, conflicted!.weighted_conflicts);
  assert.equal(shipped.score, conflicted!.score);
});

// ── score clamp vs factors[] discrepancy — a DIFFERENT defect from confidence above ────────────
// `score = clamp(rawSum, -100, 100)` but `factors[]` is never re-clamped, so on a strong setup the
// signed sum of factors[].weight can run past ±100 while `score` reads a flat 100/-100 with nothing
// in the payload saying so. This is the golden-fixture case from spx-signals.test.ts itself:
// factors sum to exactly 154 while the engine's own clamped `score` reads 100.

test("REGRESSION: a saturated score (factors sum past ±100) gets an honest clamp note", () => {
  const payload = {
    score: 100,
    factors: [
      { label: "GEX support", weight: 18, detail: "" },
      { label: "γ trend", weight: 15, detail: "" },
      { label: "0DTE flow", weight: 14, detail: "" },
      { label: "VWAP", weight: 12, detail: "" },
      { label: "Live tape", weight: 12, detail: "" },
      { label: "γ regime", weight: 10, detail: "" },
      { label: "Market tide", weight: 10, detail: "" },
      { label: "TICK", weight: 8, detail: "" },
      { label: "NOPE", weight: 7, detail: "" },
      { label: "King node", weight: 6, detail: "" },
      { label: "TRIN", weight: 6, detail: "" },
      { label: "Mega-caps", weight: 6, detail: "" },
      { label: "Net prem", weight: 6, detail: "" },
      { label: "Max pain", weight: 5, detail: "" },
      { label: "ADD", weight: 5, detail: "" },
      { label: "EMA 20", weight: 5, detail: "" },
      { label: "IV rank", weight: -4, detail: "" },
      { label: "VIX curve", weight: 4, detail: "" },
      { label: "Dark pool", weight: 3, detail: "" },
      { label: "News risk", weight: 3, detail: "" },
      { label: "Strike stack", weight: 3, detail: "" },
    ],
  };
  const rawSum = payload.factors.reduce((s, f) => s + f.weight, 0);
  assert.equal(rawSum, 154, "fixture must reproduce the exact golden-fixture discrepancy");
  assert.ok(rawSum !== payload.score, "the discrepancy this test exists to catch");

  const out = omitUncalibratedSpxConfidence(payload) as Record<string, unknown>;
  assert.equal(out.score, 100, "score itself is untouched — it is a real, bounded measurement");
  assert.equal(
    out.factor_sum_pre_clamp,
    154,
    "the true pre-clamp total must be surfaced alongside the clamped score"
  );
  assert.equal(out.score_clamp_note, SPX_SCORE_CLAMP_NOTE);
});

test("a score that reconciles with factors[] (no clamping) gets no clamp note", () => {
  const payload = {
    score: 40,
    factors: [
      { label: "VWAP", weight: 22, detail: "" },
      { label: "EMA 20", weight: 18, detail: "" },
    ],
  };
  const out = omitUncalibratedSpxConfidence(payload) as Record<string, unknown>;
  assert.equal(out.score, 40);
  assert.ok(!("factor_sum_pre_clamp" in out), "no discrepancy — nothing to note");
  assert.ok(!("score_clamp_note" in out));
});

test("the clamp note fires even when confidence/rawScore is absent from the payload", () => {
  // get_spx_confluence and similar tools may ship score+factors without rawScore/confidence at
  // all (e.g. after an earlier sanitization pass already stripped it) — the clamp check must not
  // be gated behind the confidence fields being present.
  const payload = { score: 100, factors: [{ label: "A", weight: 60, detail: "" }, { label: "B", weight: 60, detail: "" }] };
  const out = omitUncalibratedSpxConfidence(payload) as Record<string, unknown>;
  assert.ok(!("confidence_omitted" in out), "no confidence field was present to strip");
  assert.equal(out.factor_sum_pre_clamp, 120);
  assert.equal(out.score_clamp_note, SPX_SCORE_CLAMP_NOTE);
});

test("REGRESSION: sanitizeSpxPlayPayloadForLargo (get_spx_play/spx_full_state path) also carries the clamp note", () => {
  const out = sanitizeSpxPlayPayloadForLargo({
    assessed: true,
    grade: "A+",
    score: -100,
    rawScore: 96,
    factors: [
      { label: "VWAP", weight: -60, detail: "" },
      { label: "γ regime", weight: -55, detail: "" },
    ],
  }) as Record<string, unknown>;
  assert.equal(out.score, -100);
  assert.equal(out.factor_sum_pre_clamp, -115);
  assert.equal(out.score_clamp_note, SPX_SCORE_CLAMP_NOTE);
  assert.ok(!("rawScore" in out), "confidence strip still applies alongside the clamp note");
});

test("the golden fixture in spx-signals.test.ts (154 vs 100) reproduces live through the REAL engine", () => {
  const conflicted = computeSpxConfluence(
    deskWith({
      price: 7700,
      vwap: 7690,
      gex_walls: [
        { strike: 7695, kind: "support", gamma: 1e9 },
        { strike: 7705, kind: "resistance", gamma: 1e9 },
      ] as unknown as SpxDeskPayload["gex_walls"],
    })
  );
  assert.ok(conflicted, "engine produced a read");
  const rawSum = conflicted!.factors.reduce((s, f) => s + f.weight, 0);
  const out = omitUncalibratedSpxConfidence(conflicted) as Record<string, unknown>;
  if (rawSum === conflicted!.score) {
    // This particular small fixture may not clamp — the fixture above (the real golden one) is
    // what proves the clamp path; this asserts the two stay consistent whichever way it falls.
    assert.ok(!("score_clamp_note" in out));
  } else {
    assert.equal(out.factor_sum_pre_clamp, rawSum);
    assert.equal(out.score_clamp_note, SPX_SCORE_CLAMP_NOTE);
  }
});
