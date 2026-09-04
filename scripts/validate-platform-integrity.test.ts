import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** Tier-gated market routes must SKIP on 401, not WARN (unauthenticated lifecycle runs). */
test("validate-platform-integrity treats HTTP 401 as SKIP for premium market probes", () => {
  const src = readFileSync(new URL("./validate-platform-integrity.mjs", import.meta.url), "utf8");
  assert.match(src, /pos\.status === 401[\s\S]*\? "SKIP"/, "gex-positioning must SKIP on 401");
  assert.match(src, /hm\.status === 401 \? "SKIP"/, "thermal-matrix must SKIP on 401");
  assert.match(src, /vec\.status === 401 \? "SKIP"/, "vector walls must SKIP on 401");
});
