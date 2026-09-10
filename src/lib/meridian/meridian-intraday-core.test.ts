import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { etMinutesFromMs } from "./meridian-intraday-core";

describe("etMinutesFromMs: ICU midnight-as-24 quirk (#4703/#4714)", () => {
  test("just after midnight ET reads as 0-59 minutes, not 1440-1499", () => {
    // 2026-09-10T00:15:00 ET (EDT, UTC-4) = 2026-09-10T04:15:00Z.
    // `hour12: false` renders ET midnight as hour "24" in this Node/ICU build, not "00" — an
    // unnormalized read computes hh=24 -> mins=1440+15=1455 instead of the correct 0*60+15=15.
    const midnightEt = Date.parse("2026-09-10T04:15:00Z");
    assert.equal(etMinutesFromMs(midnightEt), 15);
  });

  test("an ordinary daytime ET instant is unaffected by the fold", () => {
    // 2026-09-10T09:46:00 ET (EDT) = 2026-09-10T13:46:00Z.
    const rthEt = Date.parse("2026-09-10T13:46:00Z");
    assert.equal(etMinutesFromMs(rthEt), 9 * 60 + 46);
  });
});
