import { test } from "node:test";
import assert from "node:assert/strict";
import { msUntilSpxCashOpenEt } from "./useSpxLotto";

// `hour12: false` renders ET midnight as hour "24" in this Node/ICU build, not "00" — confirmed
// directly: `new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false })
// .formatToParts(new Date("2026-09-14T04:30:15Z"))` (ET 00:30:15 EDT, UTC-4) returns hour "24".
// 2026-09-14 is a real Monday (EDT in effect, UTC-4) so this is a realistic trading-day instant,
// not a synthetic edge case.

test("msUntilSpxCashOpenEt: a midnight ET instant computes a POSITIVE ms-until-open, not a negative one from the unnormalized hour=24 quirk", () => {
  // ET 00:30:15 on a real trading Monday — well before 9:30 AM cash open.
  const midnightEt = new Date("2026-09-14T04:30:15Z");
  const ms = msUntilSpxCashOpenEt(midnightEt);
  // Correct: (9:30:00 - 0:30:15) = 8h59m45s = 32385000ms.
  // Pre-fix bug: unnormalized hour=24 makes etSecondsNow ~86400s too high, so
  // msUntilOpen comes out deeply NEGATIVE here instead — the effect's `if (msUntilOpen <= 0)
  // return;` would then silently skip scheduling the cash-open refresh for this mount.
  assert.equal(ms, 32385000);
  assert.ok(ms > 0, "must be positive — market open is still ~9 hours away from ET midnight");
});

test("msUntilSpxCashOpenEt: an instant already past 9:30 AM ET computes zero-or-negative", () => {
  // ET 10:00:00 on the same trading Monday — past cash open.
  const pastOpenEt = new Date("2026-09-14T14:00:00Z");
  const ms = msUntilSpxCashOpenEt(pastOpenEt);
  assert.ok(ms <= 0, "must be non-positive once cash open has already passed");
});

test("msUntilSpxCashOpenEt: exactly at 9:30:00 AM ET computes zero", () => {
  const atOpenEt = new Date("2026-09-14T13:30:00Z");
  assert.equal(msUntilSpxCashOpenEt(atOpenEt), 0);
});
