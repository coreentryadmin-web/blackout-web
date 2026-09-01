import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PLAN_MATRIX } from "./plan-matrix.ts";

test("plan matrix: SPX Slayer includes desk entitlements and excludes premium-only modules", () => {
  const spx = PLAN_MATRIX.spx_slayer;
  assert.match(spx.name, /SPX Slayer/);
  assert.ok(spx.includes.some((line) => /SPX Slayer desk/i.test(line)));
  assert.ok(spx.includes.some((line) => /GEX|gamma/i.test(line)));
  assert.ok(spx.excludes.some((line) => /HELIX/i.test(line)));
  assert.ok(spx.excludes.some((line) => /Largo/i.test(line)));
});

test("plan matrix: premium includes everything from SPX lane", () => {
  assert.ok(PLAN_MATRIX.premium_monthly.includes.some((line) => /Everything in SPX Slayer/i.test(line)));
});

test("whop-remodel SPX product copy matches plan matrix — no Discord-only / excludes SPX Slayer drift", () => {
  const src = readFileSync("scripts/whop-remodel.mjs", "utf8");
  assert.match(src, /BlackOut SPX Slayer/);
  assert.match(src, /SPX Slayer — \$49\/mo/);
  assert.doesNotMatch(src, /Does not include SPX Slayer/i);
  assert.doesNotMatch(src, /Community: Discord-only \(\$75\)/i);
  assert.match(src, /graded 0DTE plays/i);
});
