import { test } from "node:test";
import assert from "node:assert/strict";
import { isEtCashRth } from "@/lib/et-market-hours";

// Regression for FlowBrief.tsx's RTH gate.
//
// FlowBrief previously hand-rolled its own `isRTH()` instead of importing the canonical
// `isEtCashRth` from `@/lib/et-market-hours`: a plain weekend check + a fixed 9:30-16:00 ET
// window, with no NYSE early-close or full-holiday awareness. On an early-close half day
// (Black Friday, Christmas Eve) the real cash session ends at 1:00 PM ET, but the duplicated
// logic kept treating the window up to 4:00 PM ET as open — so between 1:00 PM and 4:00 PM ET
// on those days the live "AI brief · Live" banner (and its auto-refresh fetch) stayed active
// instead of switching to the "After hours" state, exactly the shape that produced the
// no-store-headers duplication bug (#7137) and the IOS_TOOL_NAV_LABELS orphaned-table bug
// (#7141) in this sweep: a second, hand-maintained copy of logic a canonical helper already
// owns, drifting the moment a case (here, early close) the canonical helper handles is reached.
//
// This reproduces the OLD duplicated logic inline (never imported — it only ever lived in
// FlowBrief.tsx, now removed from there) to prove the discrepancy, then asserts the canonical
// helper FlowBrief.tsx now calls gets the early-close case right.
function oldHandRolledIsRTH(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  if (["Sat", "Sun"].includes(weekday)) return false;
  const mins = hour * 60 + minute;
  return mins >= 570 && mins < 960; // 9:30-16:00 ET, no early-close/holiday awareness
}

test("FlowBrief's old hand-rolled RTH check disagreed with the canonical gate on an early-close afternoon", () => {
  // 2026-11-27 is Black Friday — NYSE early close at 1:00 PM ET. 1:30 PM ET is well after the
  // real close but inside the old hard-coded 9:30-16:00 window.
  const blackFridayAfternoon = new Date("2026-11-27T18:30:00.000Z"); // 13:30 ET
  assert.equal(oldHandRolledIsRTH(blackFridayAfternoon), true, "old logic wrongly says market open");
  assert.equal(
    isEtCashRth(blackFridayAfternoon),
    false,
    "canonical isEtCashRth correctly says the early-close session has already ended"
  );
});

test("FlowBrief's canonical RTH gate still agrees with the old logic during a normal cash session", () => {
  // 2026-11-30 2026-12-01 not needed; use an ordinary Monday mid-session instead so the two
  // only diverge on the early-close/holiday cases this fix targets, not on every input.
  const ordinaryMonday = new Date("2026-11-23T18:00:00.000Z"); // 13:00 ET, a normal Monday
  assert.equal(oldHandRolledIsRTH(ordinaryMonday), true);
  assert.equal(isEtCashRth(ordinaryMonday), true);
});

test("FlowBrief's canonical RTH gate correctly closes on a full NYSE holiday the old logic missed", () => {
  // 2026-11-26 is Thanksgiving (full NYSE closure) — a Thursday, so the old weekend-only check
  // never caught it; 11:00 AM ET is squarely inside the old hard-coded window.
  const thanksgiving = new Date("2026-11-26T16:00:00.000Z"); // 11:00 ET
  assert.equal(oldHandRolledIsRTH(thanksgiving), true, "old logic wrongly says market open on a holiday");
  assert.equal(isEtCashRth(thanksgiving), false, "canonical isEtCashRth correctly rejects the holiday");
});
