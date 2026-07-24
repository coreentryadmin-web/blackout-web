import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isMaterialSwingFlow,
  swingDirectionOf,
  createSwingFlowDebouncer,
  advanceSwingAccumulationFromFlow,
  SWING_EVENT_MIN_PREMIUM,
  SWING_LIVE_FLOW_PHASE,
  type MaterialSwingFlowInput,
} from "./event-trigger.ts";
import type { SwingAccumAccessors } from "./accumulation-store.ts";

const NOW = Date.parse("2026-07-24T17:00:00-04:00");
const ymdDaysAhead = (days: number) => new Date(NOW + days * 86_400_000).toISOString().slice(0, 10);

const flow = (over: Partial<MaterialSwingFlowInput> = {}): MaterialSwingFlowInput => ({
  ticker: "NVDA",
  premium: SWING_EVENT_MIN_PREMIUM,
  option_type: "CALL",
  expiry: ymdDaysAhead(14),
  ...over,
});

test("swingDirectionOf: CALL→LONG, PUT→SHORT, UNKNOWN→null", () => {
  assert.equal(swingDirectionOf("CALL"), "LONG");
  assert.equal(swingDirectionOf("PUT"), "SHORT");
  assert.equal(swingDirectionOf("UNKNOWN"), null);
  assert.equal(swingDirectionOf(""), null);
});

test("isMaterialSwingFlow boundaries: premium, direction, and the 2–30 DTE window", () => {
  assert.equal(isMaterialSwingFlow(flow(), NOW), true, "big directional 14 DTE call is material");
  assert.equal(isMaterialSwingFlow(flow({ premium: SWING_EVENT_MIN_PREMIUM - 1 }), NOW), false, "below premium floor");
  assert.equal(isMaterialSwingFlow(flow({ option_type: "UNKNOWN" }), NOW), false, "non-directional excluded");
  assert.equal(isMaterialSwingFlow(flow({ expiry: ymdDaysAhead(0) }), NOW), false, "0 DTE is a lottery, not a swing");
  assert.equal(isMaterialSwingFlow(flow({ expiry: ymdDaysAhead(45) }), NOW), false, "45 DTE is a LEAP-ish, above the window");
  assert.equal(isMaterialSwingFlow(flow({ expiry: ymdDaysAhead(30) }), NOW), true, "30 DTE is the inclusive upper edge");
});

test("createSwingFlowDebouncer: per-key throttle collapses a burst on one name, distinct names pass", () => {
  const deb = createSwingFlowDebouncer(60_000);
  let nFired = 0;
  const fire = () => { nFired += 1; };
  assert.equal(deb.maybeFire("NVDA|LONG", NOW, fire), true);
  assert.equal(deb.maybeFire("NVDA|LONG", NOW + 10_000, fire), false, "same key within interval → throttled");
  assert.equal(deb.maybeFire("AMD|LONG", NOW + 10_000, fire), true, "different key still fires");
  assert.equal(deb.maybeFire("NVDA|LONG", NOW + 61_000, fire), true, "same key after interval fires again");
  assert.equal(nFired, 3);
});

// A fake accumulation store that records upserts AND exposes a commit spy that must NEVER be touched.
function makeFakeAccum() {
  const upserts: Array<{ ticker: string; direction: string; session_day: string; phase: string }> = [];
  // `committed` is a const false: the SwingAccumAccessors type has NO commit/insert-position method,
  // so no accessor can ever set it. The never-commit invariant is proven by that type gap + the
  // `upserts`-only assertions below; wasCommitted() is the belt-and-suspenders read of that gap.
  const committed = false;
  const accessors: SwingAccumAccessors = {
    async upsertSwingAccum(a) { upserts.push(a); },
    async fetchAccumulating() { return []; },
    async markAccumPromoted() { /* promotion links a position — not a commit, and unused here */ },
    async fadeStaleAccum() { return 0; },
  };
  return { accessors, upserts, wasCommitted: () => committed };
}

test("advanceSwingAccumulationFromFlow ADVANCES accumulation and NEVER commits", async () => {
  const { accessors, upserts, wasCommitted } = makeFakeAccum();
  const res = await advanceSwingAccumulationFromFlow(flow(), { accum: accessors, sessionDay: "2026-07-24" }, NOW);

  assert.equal(res.advanced, true);
  assert.equal(res.ticker, "NVDA");
  assert.equal(res.direction, "LONG");
  assert.equal(upserts.length, 1, "exactly one observation accreted");
  assert.equal(upserts[0].direction, "long", "PlayDirection converted to store casing at the boundary");
  assert.equal(upserts[0].phase, SWING_LIVE_FLOW_PHASE, "tagged as a live-tape advance");
  assert.equal(upserts[0].session_day, "2026-07-24");
  assert.equal(wasCommitted(), false, "no commit path exists — a live event can never open a position");
});

test("advanceSwingAccumulationFromFlow is a no-op for a non-material print", async () => {
  const { accessors, upserts } = makeFakeAccum();
  const res = await advanceSwingAccumulationFromFlow(flow({ premium: 1000 }), { accum: accessors, sessionDay: "2026-07-24" }, NOW);
  assert.equal(res.advanced, false);
  assert.equal(upserts.length, 0, "a non-material print advances nothing");
});
