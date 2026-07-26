import assert from "node:assert/strict";
import test from "node:test";
import { deriveWhyNow, readPinnedWhyNow } from "./why-now";

// ── deriveWhyNow — every reason maps to a REAL committed signal, in priority order ─────
test("why-now: multi-day accumulation is the top-priority trigger", () => {
  const wn = deriveWhyNow({ discovery_origin: ["FLOW", "BREAKOUT"], flow_accumulation: { days: 3 } });
  assert.equal(wn?.reason, "accumulation");
  assert.match(wn!.label, /3d build/);
});

test("why-now: a 1-day 'build' is NOT accumulation (falls through to the origin)", () => {
  const wn = deriveWhyNow({ discovery_origin: ["BREAKOUT"], flow_accumulation: { days: 1 } });
  assert.equal(wn?.reason, "breakout");
});

test("why-now: BREAKOUT origin → breakout", () => {
  assert.equal(deriveWhyNow({ discovery_origin: ["BREAKOUT"] })?.reason, "breakout");
});

test("why-now: PIN origin → gamma-wall pin", () => {
  const wn = deriveWhyNow({ discovery_origin: ["PIN"] });
  assert.equal(wn?.reason, "pin");
  assert.match(wn!.label, /pin/i);
});

test("why-now: swept flow over the threshold → sweep (before the generic flow fallback)", () => {
  assert.equal(deriveWhyNow({ discovery_origin: ["FLOW"], sweep_pct: 0.7 })?.reason, "sweep");
});

test("why-now: below the sweep threshold → not a sweep", () => {
  assert.equal(deriveWhyNow({ discovery_origin: ["FLOW"], sweep_pct: 0.3 })?.reason, "aggressor_flow");
});

test("why-now: spike outranks the plain-flow fallback", () => {
  assert.equal(deriveWhyNow({ discovery_origin: ["FLOW"], spike: true })?.reason, "flow_spike");
});

test("why-now: plain FLOW origin → aggressor_flow", () => {
  assert.equal(deriveWhyNow({ discovery_origin: ["FLOW"] })?.reason, "aggressor_flow");
});

test("why-now: NO supporting signal → null (ribbon omitted, never fabricated)", () => {
  assert.equal(deriveWhyNow({}), null);
  assert.equal(deriveWhyNow({ discovery_origin: [] }), null);
  assert.equal(deriveWhyNow({ discovery_origin: null, sweep_pct: null, spike: null, flow_accumulation: null }), null);
});

// ── readPinnedWhyNow — structural, fail-soft reader ───────────────────────────────────
test("readPinnedWhyNow: round-trips a valid pinned blob", () => {
  const wn = deriveWhyNow({ discovery_origin: ["PIN"] })!;
  assert.deepEqual(readPinnedWhyNow({ why_now: wn }), wn);
});

test("readPinnedWhyNow: absent / malformed → null (never a fabricated reason)", () => {
  assert.equal(readPinnedWhyNow(null), null);
  assert.equal(readPinnedWhyNow({}), null);
  assert.equal(readPinnedWhyNow({ why_now: null }), null);
  assert.equal(readPinnedWhyNow({ why_now: "sweep" }), null); // not an object
  assert.equal(readPinnedWhyNow({ why_now: { reason: "unknown_x", label: "x" } }), null); // bad reason
  assert.equal(readPinnedWhyNow({ why_now: { reason: "sweep" } }), null); // no label
  assert.equal(readPinnedWhyNow({ why_now: { reason: "sweep", label: "" } }), null); // empty label
});
