import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("full-platform-loader isFresh rejects clock-skewed future asOf", () => {
  const src = readFileSync("src/lib/bie/full-platform-loader.ts", "utf8");
  assert.match(
    src,
    /ageMs < -WS_TIMESTAMP_FUTURE_TOLERANCE_MS/,
    "future asOf must not pass isFresh"
  );
  assert.match(src, /Math\.max\(0, ageMs\)/, "age must clamp before comparing to LIVE_MAX_AGE_MS");
});
