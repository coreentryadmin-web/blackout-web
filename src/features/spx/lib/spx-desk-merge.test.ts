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
