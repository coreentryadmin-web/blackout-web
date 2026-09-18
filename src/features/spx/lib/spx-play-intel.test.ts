import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlayIdea } from "@/features/spx/lib/spx-play-intel";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxConfluence } from "@/features/spx/lib/spx-signals";

/**
 * Regression for the "direction: null but play_idea reads confidently one-sided" trace flagged
 * by the standing Ask Largo / 5-engine monitor (cycle 2026-09-09, off SPX Slayer live GET
 * /api/market/spx/play): score +8, bias "neutral" (abs(score) < 10 stays WAIT/neutral per
 * spx-signals.ts), confluence.direction correctly null — but resolveLeanDirection's final
 * fallback in spx-play-intel.ts ignored the score's own sign entirely and used `desk.above_vwap`
 * instead, which can (and, live, did) disagree with the sign of the very score it's supposed to
 * summarize: score was net +8 (weakly bullish) while above_vwap was false (price sat below VWAP
 * that snapshot), so the fallback asserted "short" — the play_idea line read
 * "Tape's mixed, but Puts lean" while the net weighted score said the opposite.
 *
 * Fix: when bias is neutral (direction null) and |score| < 12 (below the resolveLeanDirection's
 * own explicit-lean threshold), prefer the SIGN of the score itself before falling back to the
 * VWAP proxy — score is the aggregate the caller already trusts enough to display, so a fallback
 * that contradicts its sign is misleading by construction. Only a genuinely zero score (no lean
 * information at all) falls through to the VWAP-position proxy.
 */

function fixture(score: number, aboveVwap: boolean): { desk: SpxDeskPayload; confluence: SpxConfluence } {
  const desk = {
    price: 7673.52,
    vwap: 7685.91,
    above_vwap: aboveVwap,
    gex_walls: [],
    levels: [],
  } as unknown as SpxDeskPayload;

  const confluence = {
    action: "WAIT",
    bias: "neutral",
    rawScore: 39,
    score,
    headline: "",
    thesis: "",
    factors: [
      { label: "0DTE flow", weight: 14, detail: "Call premium leading 0DTE tape" },
      { label: "Market tide", weight: -10, detail: "bearish broad flow" },
      { label: "TICK", weight: -8, detail: "NYSE TICK -353" },
    ],
    levels: { entry: 7718.6, stop: null, target: null, invalidation: "" },
    as_of: new Date().toISOString(),
    grade: "D",
    conflicts: 3,
    weighted_conflicts: 5,
    agreeing: 0,
    direction: null,
  } as unknown as SpxConfluence;

  return { desk, confluence };
}

test("buildPlayIdea leans with the score's own sign in the neutral zone, not an unrelated VWAP proxy that can disagree with it", () => {
  // Net score +8 (weakly bullish) but price below VWAP (above_vwap=false) — the exact live
  // disagreement. The idea must not assert "short"/"Puts" here.
  const { desk, confluence } = fixture(8, false);
  const idea = buildPlayIdea(desk, confluence);
  assert.ok(idea, "expected a play idea");
  assert.equal(idea!.direction, "long", "a net-positive score must not produce a short/Puts lean");
  assert.equal(idea!.option_type, "call");
  assert.match(idea!.line, /Calls/);
});

test("buildPlayIdea leans short with a net-negative score even when above_vwap is true", () => {
  const { desk, confluence } = fixture(-8, true);
  const idea = buildPlayIdea(desk, confluence);
  assert.ok(idea);
  assert.equal(idea!.direction, "short", "a net-negative score must not produce a long/Calls lean");
  assert.equal(idea!.option_type, "put");
  assert.match(idea!.line, /Puts/);
});

test("buildPlayIdea still falls back to the VWAP proxy when the score is exactly zero (no lean information at all)", () => {
  const { desk, confluence } = fixture(0, false);
  const idea = buildPlayIdea(desk, confluence);
  assert.ok(idea);
  assert.equal(idea!.direction, "short");
});
