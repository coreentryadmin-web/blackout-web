import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { mergeFlowIntoDesk, mergePulseIntoDesk, resetSpxDeskMergeCache } from "./spx-desk-merge";
import type { SpxDeskFlow, SpxDeskPayload, SpxDeskPulse } from "@/features/spx/lib/spx-desk";


function deskStub(overrides: Partial<SpxDeskPayload> = {}): SpxDeskPayload {
  return {
    available: true,
    as_of: "2026-06-30T13:00:00.000Z",
    source: "polygon",
    price: 7390,
    spx_change_pct: 0.5,
    vix: 12,
    vix_change_pct: null,
    above_vwap: true,
    lod: 7294.18,
    hod: 7392.95,
    vwap: 7350,
    pdh: 7380,
    pdl: 7280,
    prior_close: 7300,
    gap_pct: null,
    gap_source: null,
    ema20: 7350,
    ema50: 7320,
    ema200: 7200,
    sma50: 7340,
    sma200: 7180,
    tick: null,
    trin: null,
    add: null,
    gex_net: null,
    gex_king: null,
    max_pain: null,
    gamma_flip: null,
    above_gamma_flip: false,
    gamma_regime: "unknown",
    gex_walls: [],
    flow_0dte_call_premium: null,
    flow_0dte_put_premium: null,
    flow_0dte_net: null,
    tide_bias: null,
    tide_call_premium: null,
    tide_put_premium: null,
    tide_net: null,
    nope: null,
    nope_net_delta: null,
    uw_iv_rank: null,
    regime: "bullish",
    levels: [],
    dark_pool: null,
    spx_flows: [],
    unified_tape: [],
    strike_stacks: [],
    net_prem_ticks: [],
    vix_term: { vix9d: null, vix3m: null, structure: "unknown", detail: "" },
    data_quality: { vix_term_partial: false, missing: [] },
    sector_heat: [],
    leader_stocks: [],
    oi_changes: [],
    iv_term_structure: [],
    macro_events: [],
    news_headlines: [],
    greek_exposure: null,
    flow_by_expiry: [],
    net_flow_by_expiry: [],
    market_breadth: null,
    mag7_greek_flow: null,
    macro_indicators: [],
    market_open: true,
    ...overrides,
  };
}

function pulseStub(overrides: Partial<SpxDeskPulse> = {}): SpxDeskPulse {
  return {
    available: true,
    polled_at: "2026-06-30T13:29:00.000Z",
    price: 7440.43,
    spx_change_pct: 0.8,
    vix: 12,
    vix_change_pct: null,
    above_vwap: true,
    lod: 7294.18,
    hod: 7392.95,
    vwap: 7350,
    pdh: 7380,
    pdl: 7280,
    prior_close: 7300,
    gap_pct: null,
    gap_source: null,
    ema20: 7350,
    ema50: 7320,
    ema200: 7200,
    sma50: 7340,
    sma200: 7180,
    tick: null,
    trin: null,
    add: null,
    internals_estimated: { tick: false, trin: false, add: false },
    regime: "bullish",
    leader_stocks: [],
    vix_term: { vix9d: null, vix3m: null, structure: "unknown", detail: "" },
    data_quality: { vix_term_partial: false, missing: [] },
    market_open: true,
    market_status: "open",
    market_label: "OPEN",
    ...overrides,
  };
}

function flowStub(overrides: Partial<SpxDeskFlow> = {}): SpxDeskFlow {
  return {
    available: true,
    polled_at: "2026-07-28T20:40:00.000Z",
    price: 7428.78,
    dark_pool: null,
    spx_flows: [],
    unified_tape: [],
    gex_walls: [{ strike: 7430, net_gex: 1e9, kind: "resistance", distance_pts: 1.22 }],
    gex_net: -1e9,
    gex_king: 7430,
    gamma_flip: null,
    above_gamma_flip: false,
    gamma_regime: "unknown",
    flow_0dte_call_premium: null,
    flow_0dte_put_premium: null,
    flow_0dte_net: null,
    strike_stacks: [],
    net_prem_ticks: [],
    flow_by_expiry: [],
    net_flow_by_expiry: [],
    greek_exposure: null,
    ...overrides,
  };
}

describe("mergePulseIntoDesk session extremes", () => {
  beforeEach(() => {
    resetSpxDeskMergeCache();
  });

  it("expands HOD to live spot when minute-bar lane lags", () => {
    const merged = mergePulseIntoDesk(deskStub(), pulseStub());
    assert.equal(merged.price, 7440.43);
    assert.equal(merged.hod, 7440.43);
    assert.equal(merged.lod, 7294.18);
    assert.ok(merged.price <= (merged.hod ?? 0));
    assert.ok(merged.price >= (merged.lod ?? 0));
  });
});

// 2026-10-08 live SPX merged desk (off-hours/EXTENDED session): price 7801.77, prior_close
// 7818.93, vwap 7790.74, vix 15.08 all real and INTERNALLY CONSISTENT in the same merged
// payload — yet spx_change_pct/vix_change_pct were null and above_vwap was false (price was
// ABOVE vwap). Root cause: mergePulseIntoDesk passed pulse.spx_change_pct / pulse.vix_change_pct
// / pulse.above_vwap straight through, never falling back to the desk's own (base) values the
// way `vix` itself already does (`pulse.vix != null && pulse.vix > 0 ? pulse.vix : base.vix`) —
// so once pulse's own fast off-hours build loses its anchor (null vwap/vix, common outside RTH)
// its own derived null/false fields silently overwrote perfectly good numbers already sitting
// in the SAME merged response. Exactly the same class of bug `above_gamma_flip` (ISSUE-18+20,
// a few lines below in this same function) was already fixed for.
describe("mergePulseIntoDesk off-hours derived-field fallback", () => {
  beforeEach(() => {
    resetSpxDeskMergeCache();
  });

  it("recomputes above_vwap from the merged price/vwap instead of trusting pulse's null-anchored flag", () => {
    // Off-hours pulse: no live vwap to anchor against, so pulse itself honestly computed
    // above_vwap=false (price vs a null vwap). Desk's sticky/base vwap is still real.
    const base = deskStub({ vwap: 7350, above_vwap: true });
    const pulse = pulseStub({ vwap: null, above_vwap: false, price: 7440.43 });
    const merged = mergePulseIntoDesk(base, pulse);
    assert.equal(merged.vwap, 7350); // sticky fallback already worked correctly
    assert.equal(merged.price, 7440.43);
    // price (7440.43) is above the merged vwap (7350) — above_vwap must say so.
    assert.equal(merged.above_vwap, true);
  });

  it("falls back to the desk's own spx_change_pct when pulse could not anchor its own", () => {
    const base = deskStub({ spx_change_pct: -0.22, prior_close: 7818.93 });
    const pulse = pulseStub({ spx_change_pct: null, price: 7801.77 });
    const merged = mergePulseIntoDesk(base, pulse);
    assert.equal(merged.spx_change_pct, -0.22);
  });

  it("keeps pulse's own live spx_change_pct when pulse DID anchor successfully (no regression)", () => {
    const base = deskStub({ spx_change_pct: -0.22 });
    const pulse = pulseStub({ spx_change_pct: 0.8 });
    const merged = mergePulseIntoDesk(base, pulse);
    assert.equal(merged.spx_change_pct, 0.8);
  });

  it("falls back to the desk's own vix_change_pct when pulse's vix itself is unavailable", () => {
    // pulse.vix is null, so merged.vix already (correctly) falls back to base.vix — but
    // vix_change_pct must take the SAME fallback, since it was computed off base.vix, not
    // off pulse's own (discarded) null vix.
    const base = deskStub({ vix: 15.08, vix_change_pct: 0.5 });
    const pulse = pulseStub({ vix: null, vix_change_pct: null });
    const merged = mergePulseIntoDesk(base, pulse);
    assert.equal(merged.vix, 15.08);
    assert.equal(merged.vix_change_pct, 0.5);
  });

  it("keeps pulse's own live vix_change_pct when pulse's vix IS live (no regression)", () => {
    const base = deskStub({ vix: 15.08, vix_change_pct: 0.5 });
    const pulse = pulseStub({ vix: 12.9, vix_change_pct: -1.3 });
    const merged = mergePulseIntoDesk(base, pulse);
    assert.equal(merged.vix, 12.9);
    assert.equal(merged.vix_change_pct, -1.3);
  });

  // BUG FOUND (Ask Largo standing mandate, 2026-10-09, live repro mid an ECS rolling deploy):
  // mergePulseIntoDesk never assigned prior_close/gap_pct/gap_source at all, so the `...base`
  // spread silently carried whatever base already had forever, with no fallback to pulse's own
  // values the way every sibling derived field here (spx_change_pct/vix_change_pct above,
  // pdh/pdl below) already gets. Harmless when base is a real desk build (it already has a
  // correct prior_close of its own) but deskShellFromPulse's FALLBACK shell starts base at
  // emptyDeskPayload (prior_close/gap_pct/gap_source all null) and relies ENTIRELY on this
  // function to carry pulse's real values through — which it silently failed to do. Live repro:
  // GET /api/market/spx/merged served available:false/prior_close:null/gap_pct:null/
  // gap_source:null while the sibling /api/market/spx/pulse route (the only data source this
  // fallback shell has) carried the real prior_close:7801.77/gap_pct/gap_source the whole time.
  it("carries prior_close/gap_pct/gap_source through from pulse when base has none (the deskShellFromPulse fallback-shell case)", () => {
    const base = deskStub({ prior_close: null, gap_pct: null, gap_source: null });
    const pulse = pulseStub({ prior_close: 7801.77, gap_pct: -0.47, gap_source: "SPX" });
    const merged = mergePulseIntoDesk(base, pulse);
    assert.equal(merged.prior_close, 7801.77);
    assert.equal(merged.gap_pct, -0.47);
    assert.equal(merged.gap_source, "SPX");
  });

  it("falls back to the desk's own prior_close/gap_pct/gap_source when pulse itself has none", () => {
    const base = deskStub({ prior_close: 7818.93, gap_pct: -0.22, gap_source: "SPX" });
    const pulse = pulseStub({ prior_close: null, gap_pct: null, gap_source: null });
    const merged = mergePulseIntoDesk(base, pulse);
    assert.equal(merged.prior_close, 7818.93);
    assert.equal(merged.gap_pct, -0.22);
    assert.equal(merged.gap_source, "SPX");
  });

  it("keeps pulse's own live prior_close/gap_pct/gap_source when pulse DID anchor successfully (no regression)", () => {
    const base = deskStub({ prior_close: 7300, gap_pct: null, gap_source: null });
    const pulse = pulseStub({ prior_close: 7440, gap_pct: 1.9, gap_source: "SPY" });
    const merged = mergePulseIntoDesk(base, pulse);
    assert.equal(merged.prior_close, 7440);
    assert.equal(merged.gap_pct, 1.9);
    assert.equal(merged.gap_source, "SPY");
  });

  // BUG FOUND (Ask Largo 5-engine live monitor, 2026-10-21, live repro): off-hours
  // buildSpxDeskPulse spreads the empty-shell's vix_term placeholder
  // ({vix9d:null,vix3m:null,structure:"unknown",detail:""}) unchanged, which is a DEFINED
  // object — a bare `pulse.vix_term ?? base.vix_term` therefore keeps the placeholder and
  // discards the real base desk's vix_term, silently dropping the "VIX curve" scoring factor.
  it("falls back to the desk's own vix_term when pulse's own is the empty off-hours placeholder", () => {
    const base = deskStub({
      vix_term: { vix9d: 16.27, vix3m: 18.99, structure: "contango", detail: "Contango — 9d 16.27 < 3M 18.99 (+2.72)" },
    });
    const pulse = pulseStub({
      vix_term: { vix9d: null, vix3m: null, structure: "unknown", detail: "" },
    });
    const merged = mergePulseIntoDesk(base, pulse);
    assert.equal(merged.vix_term.vix9d, 16.27);
    assert.equal(merged.vix_term.vix3m, 18.99);
    assert.equal(merged.vix_term.structure, "contango");
  });

  it("keeps pulse's own live vix_term when pulse DID compute real data (no regression)", () => {
    const base = deskStub({
      vix_term: { vix9d: 16.27, vix3m: 18.99, structure: "contango", detail: "stale base reading" },
    });
    const pulse = pulseStub({
      vix_term: { vix9d: 17.5, vix3m: 18.2, structure: "contango", detail: "fresh pulse reading" },
    });
    const merged = mergePulseIntoDesk(base, pulse);
    assert.equal(merged.vix_term.vix9d, 17.5);
    assert.equal(merged.vix_term.vix3m, 18.2);
    assert.equal(merged.vix_term.detail, "fresh pulse reading");
  });

  // BUG FOUND (Ask Largo standing mandate, 2026-10-25, live repro GET /api/market/spx/play):
  // mergePulseIntoDesk's `...base` spread never reassigns `available`, so it's silently
  // inherited from `base` forever — the same "field never reassigned, inherited from base/
  // emptyDeskPayload forever" shape as the prior_close/gap_pct/gap_source fix and the vix_term
  // fix above it, just one field over. deskShellFromPulse (spx-desk.ts) calls this function as
  // `mergePulseIntoDesk(emptyDeskPayload(...), pulse)` to build the fallback shell used whenever
  // the real merged desk build is cold/slow (right after a deploy, a cache miss, a cache
  // stampede) — emptyDeskPayload hardcodes available:false, and with no reassignment here that
  // stays false even when pulse carries real, live price/VWAP/EMA/tick/trin/add data (pulse's
  // own `available` is true precisely when buildSpxDeskPulse resolved real data). Downstream,
  // computeSpxConfluence (spx-signals.ts) gates on `!desk.available` and nulls confluence
  // entirely, so evaluateSpxPlayCore's closed-market branch then renders assessed:false,
  // score:0, factors:[], direction:null, grade:"D" even though real desk data was sitting right
  // there in pulse the whole time. Live-reproduced 2026-10-25: GET /api/market/spx/play served
  // available:false/score:0 off a cold shell while GET /api/market/spx/desk at the same instant
  // showed available:true, price 7623.68; forcing a fresh full-desk build via
  // GET /api/market/spx/merged then made /play correctly return assessed:true, score:-4 for the
  // identical session.
  it("marks the merged shell available when pulse carries real data even though base (the empty fallback shell) does not", () => {
    const base = deskStub({ available: false });
    const pulse = pulseStub({ available: true });
    const merged = mergePulseIntoDesk(base, pulse);
    assert.equal(merged.available, true);
  });

  it("keeps the merged shell available when base was already a real build (no regression)", () => {
    const base = deskStub({ available: true });
    const pulse = pulseStub({ available: true });
    const merged = mergePulseIntoDesk(base, pulse);
    assert.equal(merged.available, true);
  });

  it("stays unavailable when neither base nor pulse has real data", () => {
    const base = deskStub({ available: false });
    const pulse = pulseStub({ available: false });
    const merged = mergePulseIntoDesk(base, pulse);
    assert.equal(merged.available, false);
  });
});

// BUG FIX (2026-10-31, Ask Largo/5-engine standing mandate, live repro — Saturday, market
// closed): stickyStructureLevel's non-hod/lod branch (`pulseVal ?? baseVal ??
// lastGoodStructure[key] ?? null`) serves a cross-request "last-known-good" VWAP forever once
// both pulse.vwap and base.vwap go null (any non-trading day), with nothing on the merged desk
// disclosing it — unlike gex_stale, which exists for the identical class of problem on the GEX
// ladder. Confirmed live: GET /api/market/spx/play scored a "Below VWAP 7580.87 — sellers
// pressing" factor (-12) off a sticky Friday close on a Saturday, while the sibling
// GET /api/market/spx/desk (peekSpxDesk(), no sticky merge) correctly reported vwap:null at the
// same instant.
describe("mergePulseIntoDesk vwap_stale disclosure", () => {
  beforeEach(() => {
    resetSpxDeskMergeCache();
  });

  it("marks vwap_stale:true once both pulse.vwap and base.vwap go null and only the sticky cache still carries a value forward", () => {
    // Prior cycle (e.g. Friday RTH): a real VWAP seeds the sticky cache.
    mergePulseIntoDesk(deskStub({ vwap: 7580.87 }), pulseStub({ vwap: 7580.87 }));

    // This cycle (e.g. Saturday): both live sources are honestly null, but the sticky cache
    // still has Friday's value and keeps serving it.
    const closedBase = deskStub({ vwap: null, market_open: false });
    const closedPulse = pulseStub({ vwap: null, market_open: false });
    const merged = mergePulseIntoDesk(closedBase, closedPulse);

    assert.equal(merged.vwap, 7580.87, "sticky fallback still carries the last-known VWAP forward");
    assert.equal(
      merged.vwap_stale,
      true,
      "must flag that the served vwap did not come from a fresh pulse/base read this cycle"
    );
  });

  it("leaves vwap_stale falsy when vwap came from a fresh pulse read this cycle (no regression)", () => {
    const merged = mergePulseIntoDesk(deskStub({ vwap: 7350 }), pulseStub({ vwap: 7360 }));
    assert.equal(merged.vwap, 7360);
    assert.ok(!merged.vwap_stale, "a fresh pulse-sourced vwap must not be flagged stale");
  });

  it("leaves vwap_stale falsy when vwap came from a fresh base read this cycle (pulse itself has none)", () => {
    const merged = mergePulseIntoDesk(deskStub({ vwap: 7350 }), pulseStub({ vwap: null }));
    assert.equal(merged.vwap, 7350);
    assert.ok(!merged.vwap_stale, "a fresh base-sourced vwap must not be flagged stale");
  });
});

// BUG FIX (2026-11-01, Ask Largo/5-engine standing mandate, live repro): stickyStructureLevel's
// hod/lod branch used to Math.max/Math.min across [pulseVal, baseVal, lastGoodStructure[key],
// livePrice] UNCONDITIONALLY every cycle, so a single bad/stale candidate (an off-hours pulse
// lane carrying forward a stale snapshot via `lastPulseForSignals`, or a transient index-feed
// glitch during RTH) ratcheted `lastGoodStructure.hod` upward and then kept re-entering that same
// inflated value into the max on every SUBSEQUENT cycle, permanently out-ranking a correct,
// fresh `baseVal` for the rest of the session. Confirmed live: `market_recap.spx_desk.hod`
// read 7758.43 — above both the real daily bar's H (7637) and PDH (7732.21) — for a session the
// recap narrative said gapped down and "continued lower" the whole day, with market_label
// EXTENDED (off-hours, no live spot to reconcile against).
describe("mergePulseIntoDesk off-hours hod/lod sticky-ratchet correction", () => {
  beforeEach(() => {
    resetSpxDeskMergeCache();
  });

  it("prefers a fresh, lower base hod over a stale/inflated sticky-ratcheted value off-hours", () => {
    // Prior cycle (e.g. an earlier session, or a bad tick mid-RTH): an inflated HOD seeds the
    // sticky cache the same way a real one would.
    mergePulseIntoDesk(
      deskStub({ hod: 7758.43, market_open: true }),
      pulseStub({ hod: 7758.43, price: 7758.43, market_open: true })
    );

    // This cycle (off-hours/EXTENDED): the pulse lane still carries the stale 7758.43 forward
    // (e.g. via lastPulseForSignals, spx-desk.ts), but the full desk build (`base`) has
    // recomputed a correct, fresh, LOWER hod from the real daily bar — the session gapped down
    // and never traded above 7637. No live spot to reconcile against off-hours.
    const closedBase = deskStub({ hod: 7637, market_open: false });
    const closedPulse = pulseStub({ hod: 7758.43, market_open: false });
    const merged = mergePulseIntoDesk(closedBase, closedPulse);

    assert.equal(
      merged.hod,
      7637,
      "must not let a stale sticky-ratcheted hod outrank the fresh, correct base hod off-hours"
    );
  });

  it("prefers a fresh, higher base lod over a stale/deflated sticky-ratcheted value off-hours", () => {
    mergePulseIntoDesk(
      deskStub({ lod: 7200, market_open: true }),
      pulseStub({ lod: 7200, price: 7200, market_open: true })
    );

    const closedBase = deskStub({ lod: 7528, market_open: false });
    const closedPulse = pulseStub({ lod: 7200, market_open: false });
    const merged = mergePulseIntoDesk(closedBase, closedPulse);

    assert.equal(
      merged.lod,
      7528,
      "must not let a stale sticky-ratcheted lod outrank the fresh, correct base lod off-hours"
    );
  });

  it("still falls back to the sticky cache off-hours when there is genuinely no fresh hod/lod anywhere (no regression)", () => {
    mergePulseIntoDesk(
      deskStub({ hod: 7392.95, lod: 7294.18, market_open: true }),
      pulseStub({ hod: 7392.95, lod: 7294.18, price: 7392.95, market_open: true })
    );

    // A cold-replica off-hours pulse (empty shell) plus a base that itself couldn't resolve a
    // real session extreme this cycle — the only honest option left is the sticky last-known.
    const merged = mergePulseIntoDesk(
      deskStub({ hod: null, lod: null, market_open: false }),
      pulseStub({ hod: null, lod: null, market_open: false })
    );
    assert.equal(merged.hod, 7392.95, "sticky fallback still carries the last-known hod forward");
    assert.equal(merged.lod, 7294.18, "sticky fallback still carries the last-known lod forward");
  });

  it("leaves the RTH live-spot widen behavior unchanged (no regression)", () => {
    // Same scenario as "expands HOD to live spot when minute-bar lane lags" above, but exercised
    // again here to pin the RTH branch is untouched by the off-hours fix.
    const merged = mergePulseIntoDesk(deskStub(), pulseStub());
    assert.equal(merged.hod, 7440.43);
    assert.equal(merged.lod, 7294.18);
  });
});

describe("mergeFlowIntoDesk gamma flip truth", () => {
  it("keeps an explicit null live flip — does not resurrect sticky desk flip", () => {
    const base = deskStub({ gamma_flip: 7596.4, above_gamma_flip: false, price: 7428.78 });
    const merged = mergeFlowIntoDesk(base, flowStub({ gamma_flip: null }));
    assert.equal(merged.gamma_flip, null);
    assert.equal(merged.above_gamma_flip, false);
    assert.equal(
      merged.levels.find((l) => l.label.toLowerCase().includes("flip"))?.value ?? null,
      null
    );
  });

  it("still overlays a live non-null flip from the flow lane", () => {
    const base = deskStub({ gamma_flip: 7596.4, price: 7428.78 });
    const merged = mergeFlowIntoDesk(
      base,
      flowStub({ gamma_flip: 7430, above_gamma_flip: false, gamma_regime: "short" })
    );
    assert.equal(merged.gamma_flip, 7430);
  });
});
