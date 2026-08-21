import assert from "node:assert/strict";
import test from "node:test";

import { etStampFromMs } from "@/features/nighthawk/lib/session";

test("stamps an epoch-ms instant as a readable ET date and time", () => {
  // 2026-08-20T20:04:00Z is 16:04 ET (EDT, UTC-4) — one minute past the close.
  // The raw epoch alone reads as "20:04", which is the exact misreading this prevents.
  assert.equal(etStampFromMs(1_787_256_240_000), "2026-08-20 16:04 ET");
});

test("crosses the UTC day boundary onto the correct ET session date", () => {
  // 2026-08-21T00:19:00Z is still 2026-08-20 in ET. A stamp that reported 08-21 here
  // would misdate the session by a full day — PR #2418's defect in miniature.
  assert.equal(etStampFromMs(1_787_271_540_000), "2026-08-20 20:19 ET");
});

test("renders ET midnight as 00, never 24", () => {
  const stamp = etStampFromMs(Date.UTC(2026, 7, 20, 4, 0, 0)); // 00:00 ET
  assert.equal(stamp, "2026-08-20 00:00 ET");
  assert.doesNotMatch(String(stamp), /\s24:/);
});

test("handles EST as well as EDT", () => {
  // 2026-01-15T20:04:00Z is 15:04 ET (EST, UTC-5) — a fixed -4 offset would say 16:04.
  assert.equal(etStampFromMs(Date.UTC(2026, 0, 15, 20, 4, 0)), "2026-01-15 15:04 ET");
});

test("returns null rather than fabricating a date for a non-epoch", () => {
  for (const bad of [null, undefined, NaN, Infinity, -Infinity, "1787256240000", {}, []]) {
    assert.equal(etStampFromMs(bad), null, `should be null for ${String(bad)}`);
  }
});

test("0 is not silently dressed up as a real timestamp", () => {
  // 0 IS a finite epoch-ms (1970), so it stamps — but it must stamp as 1969/1970 ET,
  // visibly wrong to a reader, rather than being quietly coerced to "now".
  const stamp = etStampFromMs(0);
  assert.match(String(stamp), /^19(69|70)-/);
});
