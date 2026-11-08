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

test("fitPlatformSnapshotForModel: a near-budget spx combined with realistic flows+nighthawk still stays under the transport cap", () => {
  // MEASURED live 2026-10-17: get_platform_snapshot TRUNCATED at 131690/16000 chars with the
  // DEFAULT include set (spx+flows+nighthawk, no largo) — the test above (added for the earlier
  // #3156 fix) uses `flows: []` and tiny nighthawk/largo stubs, so it never exercises the real
  // bug: fitSpxStructureForModel was called with NO budget override, so it fit raw.spx to the
  // FULL LARGO_RESULT_CHAR_BUDGET (14000 chars) in total isolation, then a REAL flows array and
  // nighthawk summary got added on top of that already-full budget. This fixture uses a realistic
  // flows array (not empty) and a realistic nighthawk digest shape (not a 2-byte stub) precisely
  // so this test cannot pass by luck the way the old one did.
  const raw = {
    spx: oversizedSpx(),
    flows: rows(50, 500),
    nighthawk: {
      available: true,
      edition_for: "2026-10-19",
      published_at: "2026-10-16T21:42:41.000Z",
      recap_headline: "No scored dossiers after staging (20 candidate(s)).",
      play_count: 4,
      top_tickers: ["AI", "EWY", "MRNA", "SHOP"],
    },
    largo: null,
  };
  const { fitted } = fitPlatformSnapshotForModel(raw);
  assert.ok(
    JSON.stringify(fitted).length < TRANSPORT_CAP,
    `fitted payload ${JSON.stringify(fitted).length} must be under ${TRANSPORT_CAP} even with realistic sibling fields present`
  );
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

/** `raw.flows` shaped like the REAL `FlowTapeSummary` getPlatformSnapshot() actually assigns
 *  (`src/lib/platform/types.ts`) — an OBJECT with a nested `.recent` array plus aggregates/
 *  session-anchor fields, never a bare array. Every test above uses a bare array, which is not
 *  the shape production ever passes — so none of them exercise the real bug. */
function realFlowTapeSummary(n = 50) {
  return {
    as_of: "2026-11-08T15:00:00.000Z",
    session_date: "2026-11-08",
    count: n,
    total_premium: 12_345_678,
    top_tickers: [{ ticker: "NVDA", premium: 500_000, count: 3 }],
    recent: rows(n, 50),
    strike_stacks: [],
    pull_skew: { call_pct: 0.6, call_premium: 7_000_000, put_premium: 5_345_678, total_premium: 12_345_678, prints: n },
  };
}

test("fitPlatformSnapshotForModel: real FlowTapeSummary shape is capped, never silently dropped", () => {
  // Regression: the `Array.isArray(raw.flows)` guard only matched a bare array. Production's
  // raw.flows is the FlowTapeSummary OBJECT above, so it matched NEITHER the array branch nor
  // anything else — the whole `flows` field vanished from the Largo-facing result (not
  // truncated: entirely absent), while get_flow_tape's own sibling fitter correctly unwraps this
  // identical shape. A model asking get_platform_snapshot for flow context got none, with no
  // signal that anything was omitted.
  const raw = { spx: null, flows: realFlowTapeSummary(50), nighthawk: null, largo: null };
  const { fitted } = fitPlatformSnapshotForModel(raw, 20);
  assert.ok("flows" in fitted, "flows must not be silently dropped for the real FlowTapeSummary shape");
  assert.equal(fitted.flows_shown, 20, "recent array must be capped to flowLimitForModel");
  assert.equal(fitted.flows_truncated, true);
  const flows = fitted.flows as Record<string, unknown>;
  assert.equal(Array.isArray(flows.recent), true);
  assert.equal((flows.recent as unknown[]).length, 20, "the capped array lives under .recent, matching the real shape");
  // Aggregates/session-anchor fields beside `.recent` must survive the cap untouched.
  assert.equal(flows.session_date, "2026-11-08");
  assert.equal(flows.total_premium, 12_345_678);
  assert.deepEqual(flows.top_tickers, [{ ticker: "NVDA", premium: 500_000, count: 3 }]);
});

test("fitPlatformSnapshotForModel: real FlowTapeSummary under the cap passes through, recent untouched", () => {
  const raw = { spx: null, flows: realFlowTapeSummary(5), nighthawk: null, largo: null };
  const { fitted } = fitPlatformSnapshotForModel(raw, 20);
  const flows = fitted.flows as Record<string, unknown>;
  assert.equal((flows.recent as unknown[]).length, 5);
  assert.equal(fitted.flows_truncated, false);
});

test("fitPlatformSnapshotForModel: real spx+flows(FlowTapeSummary)+nighthawk combined still stays under the transport cap", () => {
  // Restoring flows (the fix above) must not reopen the #3159/follow-up budget-overrun bug —
  // spx is still fit LAST against whatever budget remains once the real, now-present flows
  // object is already accounted for.
  const raw = {
    spx: oversizedSpx(),
    flows: realFlowTapeSummary(50),
    nighthawk: {
      available: true,
      edition_for: "2026-11-07",
      published_at: "2026-11-07T21:42:41.000Z",
      recap_headline: "No scored dossiers after staging (12 candidate(s)).",
      play_count: 3,
      top_tickers: ["AI", "NVDA", "SMCI"],
    },
    largo: null,
  };
  const { fitted } = fitPlatformSnapshotForModel(raw, 20);
  assert.ok("flows" in fitted, "flows must be present now that the real shape is handled");
  assert.ok(
    JSON.stringify(fitted).length < TRANSPORT_CAP,
    `fitted payload ${JSON.stringify(fitted).length} must be under ${TRANSPORT_CAP} with real flows restored`
  );
});
