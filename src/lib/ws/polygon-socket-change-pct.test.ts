import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeSessionChangePct } from "./polygon-socket";

test("computeSessionChangePct: rounds to 2dp, matching the REST sibling in polygon.ts", () => {
  // 6741.7301...% raw would previously have been served unrounded straight to the client.
  assert.equal(computeSessionChangePct(6749.36, 6700.123456), 0.73);
});

test("computeSessionChangePct: returns 0 when there is no session anchor yet", () => {
  assert.equal(computeSessionChangePct(6749.36, 0), 0);
});

test("computeSessionChangePct: negative change rounds correctly", () => {
  assert.equal(computeSessionChangePct(6650, 6700), -0.75);
});

test("computeSessionChangePct: never returns more than 2 decimal digits", () => {
  const result = computeSessionChangePct(100.123456789, 99.987654321);
  const decimals = String(result).split(".")[1] ?? "";
  assert.ok(decimals.length <= 2, `expected <=2 decimals, got ${result}`);
});

test("polygon-socket V ticks: only recompute change_pct on REST-anchored entries (source scan)", () => {
  const src = readFileSync(new URL("./polygon-socket.ts", import.meta.url), "utf8");
  assert.match(src, /const changeAuthoritative = prev\.open_source === "rest"/);
  const vStart = src.indexOf('} else if (ev === "V")');
  assert.ok(vStart > 0, "V-channel handler exists");
  const vHandler = src.slice(vStart, vStart + 2500);
  assert.match(vHandler, /changeAuthoritative && prev\.session_open > 0/);
});
