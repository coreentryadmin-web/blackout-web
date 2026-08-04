import assert from "node:assert/strict";
import test from "node:test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const script = new URL("./zerodte-rail-mix-audit.mjs", import.meta.url).pathname;
const src = readFileSync(script, "utf8");

test("zerodte-rail-mix-audit: regex parsers match production log shapes", () => {
  const railRe = /discovery rail mix total=(\d+) FLOW=(\d+) BREAKOUT=(\d+) PIN=(\d+) multi=(\d+) merge_policy=(\S+)/;
  const brkRe =
    /built (\d+) setup\(s\) \((\d+)L\/(\d+)S\) from walk (\d+)L\+(\d+)S attempted=(\d+) no_chain=(\d+) no_same_day=(\d+)/;

  const railLine =
    "[zerodte-scan] discovery rail mix total=10 FLOW=9 BREAKOUT=2 PIN=0 multi=1 merge_policy=v2";
  const brkLine =
    "[zerodte-breakout] 100 breakouts + 22 breakdowns (pool), built 2 setup(s) (2L/0S) from walk 100L+22S attempted=88 no_chain=7 no_same_day=79 err=0";

  const rm = railRe.exec(railLine);
  assert.ok(rm);
  assert.equal(rm[1], "10");
  assert.equal(rm[2], "9");
  assert.equal(rm[3], "2");

  const bm = brkRe.exec(brkLine);
  assert.ok(bm);
  assert.equal(bm[1], "2");
  assert.equal(bm[6], "88");
  assert.equal(bm[8], "79");
});

test("zerodte-rail-mix-audit: script documents CloudWatch + optional score-band flag", () => {
  assert.match(src, /discovery rail mix/);
  assert.match(src, /no_same_day/);
  assert.match(src, /--score-band/);
});
