import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { VECTOR_FULL_STATE_FIXTURE } from "./vector-full-state-fixture";
import { composeVectorDeskBrief } from "@/lib/bie/vector-desk-brief";
import type { VectorFullState } from "@/lib/bie/vector-full-state";

describe("composeVectorDeskBrief", () => {
  test("returns a structured brief with every surface label + the play sections", () => {
    const result = composeVectorDeskBrief(VECTOR_FULL_STATE_FIXTURE);

    // Headline carries the ticker, a grounded {{spot}}, and a play verb.
    assert.match(result.headline, /SPX/);
    assert.match(result.headline, /\{\{[\d,.\-+ ]+\}\}/);

    // Every Vector surface + the play breakdown appears in the body.
    for (const label of [
      "REGIME",
      "WALLS",
      "WALL DYNAMICS",
      "MAGNET",
      "MAX PAIN",
      "EXPECTED MOVE",
      "TECHNICALS",
      "LADDER",
      "VEX",
      "DARK POOL",
      "FLOW",
      "PLAY",
      "THESIS",
      "SETUP",
      "RISK",
      "NEXT",
    ]) {
      assert.ok(result.body.includes(label), `body missing ${label}`);
    }

    // Bias maps from the play bias: fixture play is "short" → bearish.
    assert.equal(result.bias, "bearish");
    assert.ok(["bullish", "bearish", "neutral"].includes(result.bias));

    // watch mirrors the play's starred set (headline first).
    assert.deepEqual(result.watch, VECTOR_FULL_STATE_FIXTURE.play!.starred);
    assert.ok(result.watch.length >= 1);

    // as_of passes through the state's assembly time.
    assert.equal(result.as_of, VECTOR_FULL_STATE_FIXTURE.asOf);
  });

  test("range/neutral play bias maps to a neutral desk bias", () => {
    const ranged: VectorFullState = {
      ...VECTOR_FULL_STATE_FIXTURE,
      play: { ...VECTOR_FULL_STATE_FIXTURE.play!, bias: "range" },
    };
    assert.equal(composeVectorDeskBrief(ranged).bias, "neutral");
  });

  test("degrades cleanly when there is no play (no structure)", () => {
    const noPlay: VectorFullState = { ...VECTOR_FULL_STATE_FIXTURE, play: null };
    const result = composeVectorDeskBrief(noPlay);
    assert.equal(result.bias, "neutral");
    assert.ok(result.body.includes("No clean play"));
    // Still surfaces the live reads even without a play.
    assert.ok(result.body.includes("REGIME"));
    assert.ok(result.watch.length >= 1);
  });
});

// ---------------------------------------------------------------------------
// as_of must never be fabricated
// ---------------------------------------------------------------------------

test("as_of reports the state's MEASUREMENT time, not the moment the brief was built", () => {
  const measured = "2026-08-21T14:00:00.000Z";
  const brief = composeVectorDeskBrief({ ...VECTOR_FULL_STATE_FIXTURE, asOf: measured });
  assert.equal(brief.as_of, measured);
  // The read clock is separate and must not be confused with the measurement clock.
  assert.notEqual(brief.freshness.as_of, brief.as_of);
  assert.equal(brief.freshness.observed_at, measured);
});

test("REGRESSION: an unreadable asOf yields null + 'unknown', never the reader's own clock", () => {
  // The pre-fix line was `as_of: state.asOf ?? new Date().toISOString()`, which asserted the
  // numbers were measured NOW when their age was in fact unknown. On a snapshot-and-diff product
  // that inverts "this just changed" and "this has always been so".
  for (const bad of ["", undefined as unknown as string]) {
    const brief = composeVectorDeskBrief({ ...VECTOR_FULL_STATE_FIXTURE, asOf: bad });
    assert.equal(brief.as_of, null, "an unreadable measurement time must be null, not invented");
    assert.equal(brief.freshness.freshness, "unknown");
    assert.match(brief.freshness.note ?? "", /age is unknown/);
  }
});

test("a stale measurement time is disclosed rather than presented as current", () => {
  const old = new Date(Date.now() - 12 * 60_000).toISOString();
  const brief = composeVectorDeskBrief({ ...VECTOR_FULL_STATE_FIXTURE, asOf: old });
  assert.equal(brief.freshness.freshness, "stale");
  assert.ok((brief.freshness.age_seconds ?? 0) >= 700);
  assert.match(brief.freshness.note ?? "", /has not refreshed since/);
});
