import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("roundFloats at the API boundary (Largo contextual rail)", () => {
  const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(src, /import \{ roundFloats \} from "@\/lib\/round-floats"/);
  assert.match(src, /NextResponse\.json\(\s*roundFloats\(\{/);
});

// RED->GREEN for the Largo C1 session-anchor known gap: this route used to stamp
// `as_of: new Date().toISOString()` with no ET session anchor beside it, so a caller resolving
// "today's session" purely from as_of's own UTC calendar date read a full session ahead for the
// last ~4 hours of RTH (the inversion class fixed in #2418/#2420/#2422 and the other Largo C1
// fixes this session). Deleting the `session_date` field (keeping `as_of`) is exactly what makes
// this test fail, and what previously kept the entry in session-anchor.test.ts's KNOWN_GAPS.
test("the contextual rail anchors as_of with an ET session_date off the SAME instant", () => {
  const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /import \{ etSessionDate \} from "@\/lib\/largo\/temporal\/bar-session-date"/,
    "must import the shared ET-session helper rather than deriving the date by hand"
  );
  // as_of and session_date must both read off the one `nowMs` binding — a session_date derived
  // from a SEPARATE `Date.now()` call could, in principle, straddle a UTC/ET date rollover from
  // as_of by a few milliseconds and silently describe a different instant.
  assert.match(src, /const nowMs = Date\.now\(\);/);
  assert.match(src, /as_of: new Date\(nowMs\)\.toISOString\(\),/);
  assert.match(src, /session_date: etSessionDate\(nowMs\),/);
});
