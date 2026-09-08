/**
 * Regression: CHARM depth validator exists and documents the CLQ-017 audit gap closure.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const script = join(process.cwd(), "scripts/audit/charm-depth-validate.mjs");

test("charm-depth-validate.mjs exists and imports charmPerShare test export", () => {
  const src = readFileSync(script, "utf8");
  assert.match(src, /__test_charmPerShare/);
  assert.match(src, /finite-difference|finiteDiff/i);
});

test("charm-depth-validate.mjs runs offline and PASSes the standard grid", () => {
  const out = execFileSync("node", ["--import", "tsx", script, "--json"], {
    encoding: "utf8",
    cwd: process.cwd(),
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.worst, "PASS");
  assert.ok(Array.isArray(parsed.cases) && parsed.cases.length >= 4);
});
