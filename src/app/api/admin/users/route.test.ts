import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

// Regression (2026-10-20, DISCOVERY-lane input-validation sweep): `|| "1"`/`|| "50"` only
// guard an EMPTY string — a non-numeric one (e.g. `page=abc`) is still truthy, so it skips
// that fallback, and `Number("abc")` = NaN survives `Math.max`/`Math.min` (NaN compares false
// against everything) and reaches `offset = (page - 1) * limit` = NaN with no try/catch
// anywhere in this handler, throwing uncaught inside the raw Postgres OFFSET bind or the
// Clerk Backend API call instead of degrading to the stated default.
test("page and limit fall back to their defaults on malformed (non-numeric) input, not NaN", () => {
  assert.match(
    src,
    /Number\(url\.searchParams\.get\("page"\) \|\| "1"\) \|\| 1/,
    "page must be guarded with a second `|| 1` so a non-numeric param can't survive as NaN"
  );
  assert.match(
    src,
    /Number\(url\.searchParams\.get\("limit"\) \|\| "50"\) \|\| 50/,
    "limit must be guarded with a second `|| 50` so a non-numeric param can't survive as NaN"
  );
});
