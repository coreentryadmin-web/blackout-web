import test from "node:test";
import assert from "node:assert/strict";
import { isSpxRthActive, marketStatusLabel } from "./spx-market-session";

// 2026-07-03 (Fri) is Independence Day observed (2026-07-04 is a Saturday) — a
// weekday on the clock but not a trading session. Confirmed live: isSpxRthActive
// was missing this gate, so a Polygon status of "open" (or a failed/unavailable
// status call falling through to the naive weekday+time check) reported RTH as
// active on the holiday, which fed a false "GEX SPY cold during RTH" P0 into
// data-integrity.

test("isSpxRthActive: false on a holiday even when Polygon reports the market open", () => {
  const holidayRth = new Date("2026-07-03T15:00:00.000Z"); // 11:00 ET
  assert.equal(isSpxRthActive(holidayRth, { market: "open", earlyHours: false, afterHours: false, serverTime: "" }), false);
});

test("isSpxRthActive: false on a holiday with no Polygon status at all (fallback path)", () => {
  const holidayRth = new Date("2026-07-03T15:00:00.000Z"); // 11:00 ET
  assert.equal(isSpxRthActive(holidayRth, null), false);
});

test("isSpxRthActive: true on a real trading day at the same clock time/status", () => {
  const tradingDayRth = new Date("2026-07-06T15:00:00.000Z"); // Mon 11:00 ET
  assert.equal(isSpxRthActive(tradingDayRth, { market: "open", earlyHours: false, afterHours: false, serverTime: "" }), true);
});

test("marketStatusLabel: CLOSED on a holiday, not RTH OPEN", () => {
  const holidayRth = new Date("2026-07-03T15:00:00.000Z"); // 11:00 ET
  assert.equal(marketStatusLabel(holidayRth, { market: "open", earlyHours: false, afterHours: false, serverTime: "" }), "CLOSED");
});

// Live repro 2026-10-09: the EXTENDED label rolls to PRE-MARKET at a PT-clock midnight boundary
// (~3am ET) that has NOTHING to do with whether a new RTH session has started — rthActive stays
// false straight through. A fix in spx-desk.ts that re-anchors its "today's session already
// closed" override on `label === "EXTENDED"` alone silently stops firing the instant this
// boundary is crossed, even though the underlying root cause (no partial "today" daily bar
// exists yet) is unchanged. These two labels must therefore agree on rthActive, and the window
// between them must still be well before the 9:30am ET cash open.
test("marketStatusLabel: rolls from EXTENDED to PRE-MARKET across the ET-midnight-adjacent PT boundary, with RTH still inactive on both sides (2026-10-09 root cause)", () => {
  const stillExtended = new Date("2026-10-09T07:42:00.000Z"); // ~03:42 ET
  const nowPremarket = new Date("2026-10-09T08:17:56.000Z"); // ~04:17 ET — live-reproduced bug time
  const noStatus = null;
  assert.equal(marketStatusLabel(stillExtended, noStatus), "EXTENDED");
  assert.equal(marketStatusLabel(nowPremarket, noStatus), "PRE-MARKET");
  // The one invariant any "today's own session has already closed" override must rely on:
  // RTH is inactive on BOTH sides of this label rollover, all the way up to the 9:30am ET open.
  assert.equal(isSpxRthActive(stillExtended, noStatus), false);
  assert.equal(isSpxRthActive(nowPremarket, noStatus), false);
});
