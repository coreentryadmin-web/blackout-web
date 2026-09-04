import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** Mirror tier-gate handling in scripts/validate-platform-integrity.mjs */
function tierGatedStatus(httpStatus: number, passWhen: boolean): "SKIP" | "PASS" | "WARN" {
  if (httpStatus === 401) return "SKIP";
  if (httpStatus === 200 && passWhen) return "PASS";
  return "WARN";
}

test("platform-integrity classifies 401 tier gates as SKIP not WARN", () => {
  assert.equal(tierGatedStatus(401, false), "SKIP");
  assert.equal(tierGatedStatus(401, true), "SKIP");
  assert.equal(tierGatedStatus(200, true), "PASS");
  assert.equal(tierGatedStatus(200, false), "WARN");
});

test("platform-integrity script applies 401 SKIP to gex/thermal/vector checks", () => {
  const src = readFileSync("scripts/validate-platform-integrity.mjs", "utf8");
  assert.match(src, /gex-positioning-spx[\s\S]*?pos\.status === 401/);
  assert.match(src, /thermal-matrix-\$\{t\}[\s\S]*?hm\.status === 401 \? "SKIP"/);
  assert.match(src, /vector-spx-0dte-walls[\s\S]*?vec\.status === 401 \? "SKIP"/);
});
