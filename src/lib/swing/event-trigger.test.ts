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

test("createSwingFlowDebouncer: evicts stale keys (bounds memory) while fresh keys still throttle", () => {
  const deb = createSwingFlowDebouncer(60_000);
  const noop = () => {};
  deb.maybeFire("NVDA|LONG", NOW, noop);          // NVDA last-fires at NOW
  deb.maybeFire("AMD|LONG", NOW + 59_000, noop);  // AMD last-fires just UNDER an interval later
  assert.equal(deb.size(), 2, "both keys tracked before any eviction");

  // A brand-new key fires at NOW+61s. During that fire the map is pruned: NVDA's last fire (NOW) is now a
  // full interval old → EVICTED (it could never throttle again); AMD's (NOW+59s) is still inside the
  // interval → RETAINED; the new TSLA key is inserted. Net size stays 2 — the map is bounded, not growing.
  deb.maybeFire("TSLA|LONG", NOW + 61_000, noop);
  assert.equal(deb.size(), 2, "stale NVDA evicted, fresh AMD kept, TSLA added → bounded");

  // Eviction must NOT change observable throttle behavior: AMD is still within its interval, so it is STILL
  // throttled (proves a *retained* fresh key throttles exactly as before)...
  assert.equal(deb.maybeFire("AMD|LONG", NOW + 61_000, noop), false, "retained fresh key still throttled");
  // ...and the EVICTED NVDA key fires again exactly as an un-evicted stale key would have (interval elapsed
  // → pass). If eviction changed semantics this would differ from the un-evicted path — it does not.
  assert.equal(deb.maybeFire("NVDA|LONG", NOW + 61_000, noop), true, "evicted stale key fires again — same as if kept");
});

// COMPILE-TIME never-commit guard (part (a)): the accessor surface the router can touch must expose NO
// commit / open-position accessor. Indexing `SwingAccumAccessors` by a commit-shaped key is a *type error
// today* (the key doesn't exist), which `@ts-expect-error` absorbs. If someone later adds an
// `insertSwingPosition` (or any commit) method to the type — the exact wiring that would give a live event a
// path to open a position — this indexed access becomes valid, the expected error vanishes, and `tsc` FAILS
// on the directive ("unused @ts-expect-error"), forcing the invariant back under review. This is stronger
// than a runtime read: it fails the BUILD, not just the test, the moment the never-commit type gap closes.
// @ts-expect-error — SwingAccumAccessors must have NO `insertSwingPosition` commit accessor.
type _NeverCommitByType = SwingAccumAccessors["insertSwingPosition"];

// A fake accumulation store that records upserts AND counts EVERY accessor call, so a test can assert
// exactly which accessors ran (part (b)). `markAccumPromoted` is the only accessor that links a candidate to
// a persisted position — the closest thing to a commit — so its call count is the real never-commit spy: it
// must stay at 0. If someone wires a commit/promotion path into `advanceSwingAccumulationFromFlow`, that
// counter goes non-zero and the assertion below FAILS (unlike the old `const committed = false`, which
// nothing could ever flip and so proved nothing).
function makeFakeAccum() {
  const upserts: Array<{ ticker: string; direction: string; session_day: string; phase: string }> = [];
  const calls = { upsertSwingAccum: 0, fetchAccumulating: 0, markAccumPromoted: 0, fadeStaleAccum: 0 };
  const accessors: SwingAccumAccessors = {
    async upsertSwingAccum(a) { calls.upsertSwingAccum += 1; upserts.push(a); },
    async fetchAccumulating() { calls.fetchAccumulating += 1; return []; },
    async markAccumPromoted() { calls.markAccumPromoted += 1; /* links a position — a commit path; must never run here */ },
    async fadeStaleAccum() { calls.fadeStaleAccum += 1; return 0; },
  };
  return { accessors, upserts, calls };
}

test("advanceSwingAccumulationFromFlow ADVANCES accumulation and NEVER commits", async () => {
  const { accessors, upserts, calls } = makeFakeAccum();
  const res = await advanceSwingAccumulationFromFlow(flow(), { accum: accessors, sessionDay: "2026-07-24" }, NOW);

  assert.equal(res.advanced, true);
  assert.equal(res.ticker, "NVDA");
  assert.equal(res.direction, "LONG");
  assert.equal(upserts.length, 1, "exactly one observation accreted");
  assert.equal(upserts[0].direction, "long", "PlayDirection converted to store casing at the boundary");
  assert.equal(upserts[0].phase, SWING_LIVE_FLOW_PHASE, "tagged as a live-tape advance");
  assert.equal(upserts[0].session_day, "2026-07-24");
  // The real never-commit spy: the ONLY thing the router did was accrete one observation via
  // upsertSwingAccum. The position-linking (commit-ish) accessor was NEVER called — a live event advances
  // memory, it never opens/sizes a position. This FAILS if a commit path is ever wired in.
  assert.equal(calls.upsertSwingAccum, 1, "advance = exactly one upsert");
  assert.equal(calls.markAccumPromoted, 0, "position-linking (commit) accessor NEVER called — a live event can never open a position");
});

test("advanceSwingAccumulationFromFlow is a no-op for a non-material print", async () => {
  const { accessors, upserts } = makeFakeAccum();
  const res = await advanceSwingAccumulationFromFlow(flow({ premium: 1000 }), { accum: accessors, sessionDay: "2026-07-24" }, NOW);
  assert.equal(res.advanced, false);
  assert.equal(upserts.length, 0, "a non-material print advances nothing");
});
