import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSpxPlayDeskContext } from "./spx-play-context";
import { mixedTapeBlockThreshold, mixedTapeGateMessage } from "./spx-play-gates";
import type { SpxDeskPayload } from "./spx-desk";
import type { SpxSignalFactor } from "./spx-signals";

function baseDesk(): SpxDeskPayload {
  return {
    available: true,
    market_open: true,
    price: 5500,
    gamma_flip: 5490,
    max_pain: 5510,
    news_headlines: [],
    gex_walls: [],
    polled_at: new Date().toISOString(),
  } as SpxDeskPayload;
}

test("mixedTapeBlockThreshold: B-grade strong score gets +1 tolerance", () => {
  const weak = mixedTapeBlockThreshold("B", 48);
  const strong = mixedTapeBlockThreshold("B", 60);
  assert.equal(strong, weak + 1);
});

test("mixedTapeBlockThreshold: A-grade baseline above B", () => {
  assert.ok(mixedTapeBlockThreshold("A", 50) >= mixedTapeBlockThreshold("B", 50));
});

test("buildSpxPlayDeskContext: computes conflict meter and session budget", () => {
  const ctx = buildSpxPlayDeskContext(
    baseDesk(),
    {
      score: 55,
      grade: "B",
      factors: [],
      direction: "long",
    },
    { session_entries_today: 2, session_losses_today: 1 }
  );
  assert.equal(ctx.session_entries_used, 2);
  assert.equal(ctx.session_losses_used, 1);
  assert.equal(ctx.suggested_option_type, "call");
  assert.ok(ctx.suggested_strike != null);
  assert.equal(ctx.gamma_flip_dist_pts, 10);
});

// Regression: Labor Day 2026-09-07 is a Monday (weekday) but an NYSE holiday — no
// session runs at all. Confirmed live via GET /api/market/spx/play that
// desk_context previously rendered live-looking countdowns anyway because the
// gate was isEtWeekday (weekday only, no holiday check). 14:21 ET is mid-RTH on
// an ordinary trading day, which is exactly why this date/time combination is
// the one that exposes the bug — any other weekday would pass even pre-fix.
test("buildSpxPlayDeskContext: NYSE holiday on a weekday nulls every countdown", () => {
  const laborDayAt1421Et = new Date("2026-09-07T18:21:00.000Z"); // 14:21 ET (EDT, UTC-4)
  const ctx = buildSpxPlayDeskContext(
    baseDesk(),
    { score: -18, grade: "D", factors: [], direction: "short" },
    { session_entries_today: 0, session_losses_today: 0 },
    laborDayAt1421Et
  );
  assert.equal(ctx.minutes_to_close, null);
  assert.equal(ctx.minutes_to_no_entry, null);
  assert.equal(ctx.minutes_to_force_exit, null);
});

// Same wall-clock time on an ordinary trading day (Tuesday 2026-09-08) must still
// report live countdowns — proves the fix is holiday-specific, not a blanket null.
test("buildSpxPlayDeskContext: ordinary trading day at the same ET time still counts down", () => {
  const ordinaryTuesdayAt1421Et = new Date("2026-09-08T18:21:00.000Z");
  const ctx = buildSpxPlayDeskContext(
    baseDesk(),
    { score: 55, grade: "B", factors: [], direction: "long" },
    { session_entries_today: 0, session_losses_today: 0 },
    ordinaryTuesdayAt1421Et
  );
  assert.notEqual(ctx.minutes_to_close, null);
  assert.ok((ctx.minutes_to_close ?? 0) > 0);
});

// BUG FIX (2026-10-26): spx-play-engine.ts's closed-market branch (evaluateSpxPlayCore,
// `!desk.market_open && !premarket`) hand-built `gates: {blocks:["Session closed"],
// warnings:[]}` and never called evaluatePlayGates — the only place that applies the
// mixed-tape sub-check (weighted_conflicts >= mixedTapeBlockThreshold(...)) and appends
// "Tape's mixed — too many conflicting signals for clean entry" to blocks/warnings.
// Meanwhile buildSpxPlayDeskContext (this file) independently recomputes
// `desk_context.mixed_tape_blocked` off the IDENTICAL condition, UNCONDITIONALLY — every
// response, whether gates ran or not. Confirmed live via GET /api/market/spx/play: a real
// closed-market response showed `desk_context.mixed_tape_blocked:true` alongside
// `gates.blocks:["Session closed"]` with no "Tape's mixed" text anywhere — the two fields
// silently disagreed whenever the closed-market shortcut was taken.
//
// Fix: extracted the shared condition into `mixedTapeGateMessage` (spx-play-gates.ts) —
// `evaluatePlayGates` now calls it instead of re-inlining the check, and the closed-market
// branch calls the SAME function and merges its text into `gates.warnings` (not `blocks` —
// "Session closed" already fully explains why no entry is possible; warnings is the same
// informational-only treatment `evaluatePlayGates` itself gives this check on its non-buy
// `entry_intent:"watch"` path, the closer analogue here since no BUY is ever evaluated once
// the market is closed).
//
// This test proves the two computations — desk_context's own recompute and the gate text a
// closed-market response now carries — can no longer drift apart: feeding the SAME
// confluence-shaped data (desk/score/grade/factors) into both `buildSpxPlayDeskContext` and
// `mixedTapeGateMessage` must always agree on whether the tape is "mixed". Before the fix,
// `mixedTapeGateMessage` didn't exist and the closed-market branch had no mixed-tape check of
// any kind, so this coherence did not hold — `gates.warnings` was unconditionally `[]`.
test("mixed-tape coherence: desk_context.mixed_tape_blocked and the gate's mixed-tape message never disagree", () => {
  const closedDesk = baseDesk(); // neutral desk — no tide_bias/vix/gex_walls opposition of its own
  const grade = "D";
  const score = 4; // small, directional (long) score — realistic for a thin closed-market read
  const direction = "long";

  // Generate exactly as many "soft" opposing (long-direction, weight<0) factors as the real
  // grade-scaled threshold requires — deterministic regardless of
  // SPX_PLAY_WEIGHTED_CONFLICT_BLOCK_MIN/SPX_PLAY_CONFLICT_BLOCK_MIN env overrides, rather than
  // hardcoding a magic factor count. None of the labels match the HARD_OPPOSING set
  // ("Market tide"/"Dark pool"/"IV rank"/γ*/"GEX resistance"/"GEX support" —
  // isHardOpposingFactor, spx-play-conflicts.ts), so each contributes weight 1 (not 2).
  const neededConflicts = mixedTapeBlockThreshold(grade, Math.abs(score));
  const factors: SpxSignalFactor[] = Array.from({ length: neededConflicts }, (_, i) => ({
    label: `Test opposing signal ${i + 1}`,
    weight: -1,
    detail: "synthetic conflict for coherence test",
  }));

  const ctx = buildSpxPlayDeskContext(closedDesk, { score, grade, factors, direction });

  // Sanity: this scenario really does cross the threshold the way a real mixed tape would —
  // otherwise the rest of the assertions would pass vacuously.
  assert.equal(
    ctx.mixed_tape_blocked,
    true,
    "test setup must actually cross the mixed-tape threshold (weighted_conflicts >= mixed_tape_threshold)"
  );

  // What spx-play-engine.ts's closed-market branch now does: call the SAME shared check,
  // using the identical weighted_conflicts/grade/score desk_context itself carries.
  const mixedTapeMsg = mixedTapeGateMessage({
    weighted_conflicts: ctx.weighted_conflicts,
    grade,
    score,
  });

  assert.ok(
    mixedTapeMsg != null,
    "desk_context.mixed_tape_blocked:true must have a corresponding gate message — " +
      "before the fix, a closed-market response could show mixed_tape_blocked:true with no " +
      "'Tape's mixed' text anywhere in gates.blocks/warnings"
  );
  assert.match(mixedTapeMsg!, /Tape's mixed/);

  // And the reverse must also hold: a clean tape must not fabricate a mixed-tape message.
  const cleanCtx = buildSpxPlayDeskContext(closedDesk, {
    score,
    grade,
    factors: [],
    direction,
  });
  assert.equal(cleanCtx.mixed_tape_blocked, false);
  assert.equal(
    mixedTapeGateMessage({ weighted_conflicts: cleanCtx.weighted_conflicts, grade, score }),
    null
  );
});
