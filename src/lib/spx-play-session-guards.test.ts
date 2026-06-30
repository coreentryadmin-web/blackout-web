import { test } from "node:test";
import assert from "node:assert/strict";

import { getEarlyCloseMinutes, isRthEt, CASH_OPEN_ET_MINS, RTH_CLOSE_ET_MINS } from "@/lib/spx-play-session-guards";
import { etClock } from "@/lib/spx-play-session-time";

const ENV_KEY = "SPX_EARLY_CLOSE_ET_MINS";

function withEnv(value: string | undefined, fn: () => void) {
  const prev = process.env[ENV_KEY];
  if (value === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = prev;
  }
}

// A plain weekday with no calendar early close (2026-06-23 is a Tuesday).
const NORMAL_DAY = new Date("2026-06-23T17:00:00Z");
// A calendar early-close day: Christmas Eve 2026 -> 13:00 ET = 780 min.
const EARLY_CLOSE_DAY = new Date("2026-12-24T17:00:00Z");

test("valid numeric override is honored", () => {
  withEnv("780", () => {
    assert.equal(getEarlyCloseMinutes(NORMAL_DAY), 780);
  });
});

test("non-numeric override (typo) does NOT return NaN and falls through to calendar", () => {
  withEnv("13:00", () => {
    assert.equal(getEarlyCloseMinutes(NORMAL_DAY), null);
    assert.equal(getEarlyCloseMinutes(EARLY_CLOSE_DAY), 780);
  });
});

test("garbage override falls through to calendar table", () => {
  withEnv("abc", () => {
    const v = getEarlyCloseMinutes(EARLY_CLOSE_DAY);
    assert.equal(v, 780);
    assert.equal(Number.isNaN(v as number), false);
  });
});

test("no override on a normal day returns null", () => {
  withEnv(undefined, () => {
    assert.equal(getEarlyCloseMinutes(NORMAL_DAY), null);
  });
});

test("no override on a calendar early-close day returns the close minutes", () => {
  withEnv(undefined, () => {
    assert.equal(getEarlyCloseMinutes(EARLY_CLOSE_DAY), 780);
  });
});

test("isRthEt: inside normal RTH", () => {
  assert.equal(isRthEt(new Date("2026-06-23T15:00:00Z")), true); // Tue 11:00 ET
});

test("isRthEt: before 9:30 open", () => {
  assert.equal(isRthEt(new Date("2026-06-23T13:00:00Z")), false); // Tue 9:00 ET
});

test("isRthEt: after 4:00 close", () => {
  assert.equal(isRthEt(new Date("2026-06-23T20:05:00Z")), false); // Tue 16:05 ET
});

test("isRthEt: weekend", () => {
  assert.equal(isRthEt(new Date("2026-06-27T15:00:00Z")), false); // Sat
});

test("RTH constants match 9:30 and 16:00 ET", () => {
  assert.equal(CASH_OPEN_ET_MINS, etClock(9, 30));
  assert.equal(RTH_CLOSE_ET_MINS, etClock(16, 0));
});
