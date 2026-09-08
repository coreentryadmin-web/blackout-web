import { test } from "node:test";
import assert from "node:assert/strict";
import { fitPlatformSnapshotForModel } from "./platform-snapshot-fit";

const TRANSPORT_CAP = 16_384;

const rows = (n: number, chars = 200) =>
  Array.from({ length: n }, (_, i) => ({ i, blob: "x".repeat(chars) }));

/** `raw.spx` shaped like the real `summarizeSpxDesk` output — scalars plus the same fat
 *  enrichment tail spx-structure-fit.test.ts's fixture uses, since it's the same function. */
function oversizedSpx() {
  return {
    price: 7674.37,
    vix: 14.2,
    gamma_flip: 7640,
    gex_walls: rows(40),
    spx_flows: rows(120),
    unified_tape: rows(200),
    news_headlines: rows(30),
    macro_events: rows(20),
    sector_heat: rows(20),
    oi_changes: rows(30),
  } as Record<string, unknown>;
}

test("the raw spx fixture really is over budget on its own — otherwise this proves nothing", () => {
  assert.ok(JSON.stringify(oversizedSpx()).length > TRANSPORT_CAP);
});

test("fitPlatformSnapshotForModel fits raw.spx through the SPX structure fitter, not verbatim", () => {
  const raw = { spx: oversizedSpx(), flows: [], nighthawk: { note: "ok" }, largo: { note: "ok" } };
  const { fitted } = fitPlatformSnapshotForModel(raw);
  // The regression this guards (#3156-follow-up): shipping `fitted.spx = raw.spx` verbatim left
  // get_platform_snapshot TRUNCATED live even after the flows-array cap below was already in
  // place, because raw.spx alone exceeds the cap. Prove the WHOLE fitted payload is now small.
  assert.ok(
    JSON.stringify(fitted).length < TRANSPORT_CAP,
    `fitted payload ${JSON.stringify(fitted).length} must be under ${TRANSPORT_CAP}`
  );
  // The fitter must actually have engaged (fields trimmed/shed), not merely happened to fit by
  // luck — `fitSpxStructureForModel` names what it touched in `sample_notes`.
  const spx = fitted.spx as Record<string, unknown>;
  assert.ok(spx.sample_notes, "expected the SPX structure fitter to have trimmed/shed something");
});

test("fitPlatformSnapshotForModel: small raw.spx passes through unchanged (scalars untouched)", () => {
  const raw = { spx: { price: 100, vix: 15 }, flows: [], nighthawk: null, largo: null };
  const { fitted } = fitPlatformSnapshotForModel(raw);
  assert.deepEqual(fitted.spx, { price: 100, vix: 15 });
});

test("fitPlatformSnapshotForModel: flows array is still capped and flagged, unrelated to the spx fix", () => {
  const raw = { spx: null, flows: Array.from({ length: 50 }, (_, i) => ({ i })), nighthawk: null, largo: null };
  const { fitted } = fitPlatformSnapshotForModel(raw, 20);
  assert.equal(fitted.flows_shown, 20);
  assert.equal(fitted.flows_truncated, true);
});

test("fitPlatformSnapshotForModel: missing spx/nighthawk/largo are simply absent, never fabricated", () => {
  const { fitted } = fitPlatformSnapshotForModel({ flows: [] });
  assert.equal("spx" in fitted, false);
  assert.equal("nighthawk" in fitted, false);
  assert.equal("largo" in fitted, false);
});
