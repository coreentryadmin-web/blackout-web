import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Regression for a Largo C1 ratchet blind spot (session-anchor.test.ts): that ratchet's
// `HAS_ET_ANCHOR` check is FILE-level, not construction-site-level -- it passes a file the moment
// ANY `etStamp(`/`etSessionDate(` call appears anywhere in it, even if the specific `as_of`
// construction the ratchet's own `CONSTRUCTS_UTC_STAMP` regex matched sits in a completely
// different, unprotected branch. This file used to read
// `as_of: etStamp(Date.now()) ?? new Date().toISOString()` in its catch branch -- textually a
// raw-UTC-fallback construction (confirmed: it matches CONSTRUCTS_UTC_STAMP), but the file passed
// the ratchet anyway because the SAME primary `etStamp(Date.now())` call exists a few lines above
// on the success path. `etStamp(Date.now())` can never actually return null (Date.now() is always
// a positive finite number, the only input `etDateParts` refuses), so the fallback was always dead
// code -- but a future refactor that removed the success-path `etStamp` call while leaving this
// fallback untouched would have silently produced a real unanchored stamp with no ratchet catching
// it. Fixed by removing the fallback entirely rather than merely tolerating it.
const SRC = readFileSync(fileURLToPath(new URL("./play-brief-meridian.ts", import.meta.url)), "utf8");

test("the catch-branch as_of never reintroduces a raw `?? new Date().toISOString()` fallback", () => {
  assert.ok(
    !/etStamp\(Date\.now\(\)\)\s*\?\?\s*new Date\(\)\.toISOString\(\)/.test(SRC),
    "must not reintroduce the dead, ratchet-blind-spot-exploiting fallback shape",
  );
});

test("the catch-branch as_of relies directly on etStamp(Date.now()), never a separate raw stamp", () => {
  assert.ok(
    SRC.includes("etStamp(Date.now()) as string"),
    "the catch branch should assert the always-non-null etStamp result rather than falling back",
  );
});
