import { test } from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error — plain-JS audit lib, deliberately not typed (it runs under bare node too).
import {
  asNumber,
  carriesReadableDate,
  classifyResult,
  countNumericLeaves,
  epochUnit,
  isUnroundedFloat,
  scanPayload,
  summarize,
} from "../../../scripts/audit/lib/payload-hygiene.mjs";

test("an unrounded float is the arithmetic artifact, not a quoted precision", () => {
  // Both real, both served by prod endpoints.
  assert.equal(isUnroundedFloat(7499.360000000001), true);
  assert.equal(isUnroundedFloat(7707.9800000000005), true);
  // A real quote, a whole number, and a non-number are all fine.
  assert.equal(isUnroundedFloat(7641.16), false);
  assert.equal(isUnroundedFloat(0.0625), false);
  assert.equal(isUnroundedFloat(7641), false);
  assert.equal(isUnroundedFloat("7641.16"), false);
  assert.equal(isUnroundedFloat(NaN), false);
  // Exponential notation is a magnitude choice, not a float artifact.
  assert.equal(isUnroundedFloat(1e-7), false);
});

test("epoch ranges are tight enough that prices and volumes are not timestamps", () => {
  assert.equal(epochUnit(1787202000000), "ms");
  assert.equal(epochUnit(1787202000), "s");
  assert.equal(epochUnit(7641.16), null, "an SPX print is not an epoch");
  assert.equal(epochUnit(0), null);
  assert.equal(epochUnit(9.9e12), null, "a market cap is not an epoch");
});

test("an object that already states a date in words is not making the reader guess", () => {
  assert.equal(carriesReadableDate({ t: 1787202000000, session_date: "2026-08-20" }), true);
  assert.equal(carriesReadableDate({ t: 1787202000000, c: 7641.16 }), false);
  assert.equal(carriesReadableDate(null), false);
});

test("the exact bar that produced the off-by-one-session answer is flagged", () => {
  const before = { results: [{ t: 1787202000000, c: 7641.16 }] };
  const { findings } = scanPayload(before);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "bare_epoch");
  assert.equal(findings[0].path, "results[0].t");
});

test("the same bar AFTER the session-date fix is clean", () => {
  const after = { results: [{ t: 1787202000000, c: 7641.16, session_date: "2026-08-20" }] };
  assert.deepEqual(scanPayload(after).findings, []);
});

test("only time-shaped keys are judged as time — market cap is left alone", () => {
  const { findings } = scanPayload({ row: { market_cap: 1_500_000_000_000, name: "ACME" } });
  assert.deepEqual(findings, [], "a 1.5e12 market cap must not read as a timestamp");
});

test("both classes are found and rolled up together", () => {
  const { findings } = scanPayload({
    quote: { updated_at: 1787202000000, price: 7499.360000000001 },
  });
  assert.deepEqual(summarize(findings), { unrounded_float: 1, bare_epoch: 1 });
});

test("a truncated walk says so rather than reading as a clean bill of health", () => {
  const results = Array.from({ length: 50 }, () => ({ t: 1787202000000 }));
  const out = scanPayload({ results }, { maxFindings: 10 });
  assert.equal(out.findings.length, 10);
  assert.equal(out.truncated, true, "hitting the cap must be reported, never silent");

  const small = scanPayload({ results: [{ t: 1787202000000 }] }, { maxFindings: 10 });
  assert.equal(small.truncated, false);
});

test("an EMPTY payload is never reported as clean — the trap the scanner itself fell into", () => {
  // A sandbox run with placeholder creds returned these and scored "17/17 tools clean".
  for (const emptyish of [{}, { bars: [] }, { data: [], note: "unavailable" }, null, { ok: false }]) {
    assert.equal(classifyResult(emptyish), "empty", `${JSON.stringify(emptyish)} must not be clean`);
  }
  // A payload that genuinely carries numbers is scanned for real.
  assert.equal(classifyResult({ results: [{ t: 1787202000000, c: 7641.16, o: 7700 }] }), "scanned");
  // An error beats everything — it is an unknown, not an empty and not a pass.
  assert.equal(classifyResult({ results: [{ c: 1, o: 2, h: 3 }] }, { error: new Error("x") }), "error");
});

test("numeric leaves are counted through nesting and arrays", () => {
  assert.equal(countNumericLeaves({ a: 1, b: { c: 2 }, d: [3, { e: 4 }] }), 4);
  // A numeric string IS data — UW encodes every number that way. Only non-numeric strings,
  // null and booleans are not.
  assert.equal(countNumericLeaves({ a: "1", b: null, c: true }), 1);
  assert.equal(countNumericLeaves({ a: "SPX", b: null, c: true }), 0);
  assert.equal(countNumericLeaves({ a: NaN }), 0, "NaN is not a measurement");
});

test("UW's string-encoded numerics are seen — the entire GEX/flow surface was invisible", () => {
  // Real shape from fetchUwSpotExposures("SPX"): every numeric is a STRING.
  assert.equal(asNumber("7705"), 7705);
  assert.equal(asNumber("3865614809.8"), 3865614809.8);
  assert.equal(asNumber("-28907371001.32"), -28907371001.32);
  assert.equal(asNumber("2026-08-20T10:30:58.529000Z"), null, "a timestamp string is not a number");
  assert.equal(asNumber("SPX"), null);
  assert.equal(asNumber(""), null);
  assert.equal(asNumber(null), null);

  // A UW payload now counts as data rather than reading as EMPTY.
  const uw = { data: [{ price: "7705", ticker: "SPX", gamma: "3865614809.8", charm: "-28907371001.32" }] };
  assert.equal(classifyResult(uw), "scanned");
});

test("a malformed number is malformed whether it arrived as a number or a string", () => {
  assert.equal(isUnroundedFloat("7707.9800000000005"), true);
  assert.equal(isUnroundedFloat("7641.16"), false);
  // A string keeps its OWN text: "7.10" is a deliberate 2dp quote, not 7.1.
  assert.equal(isUnroundedFloat("7.10"), false);
  assert.equal(epochUnit("1787202000000"), "ms");

  const { findings } = scanPayload({ row: { t: "1787202000000", px: "7707.9800000000005" } });
  assert.deepEqual(summarize(findings), { unrounded_float: 1, bare_epoch: 1 });
});
