// Regression coverage for task/finding: "SPX Slayer's 3-second-polled dashboard
// hardcodes signal_committed: true even when nothing was actually persisted."
//
// Root cause (docs/audit/FINDINGS.md): evaluateOpenPlay()'s shared return tail
// (spx-play-engine.ts) set `signal_committed: true` as a bare literal, never
// consulting the `mutate` flag every DB write in that same function IS gated on.
// A mutate:false call (the member-facing 3s poll, spx-evaluator.ts's
// readSpxPlaySnapshot) could show a full "SELL — TARGET" card whose
// signal_committed claimed it was graded/persisted when nothing was written —
// only the mutate:true cron path (runSpxEvaluator, every 5 min) actually commits.
//
// No test previously exercised evaluateOpenPlay's mutate:true vs mutate:false
// behavior at all (signal_committed only ever appeared as a hardcoded fixture
// value in other suites) — that gap is exactly why this shipped undetected.
//
// This file drives the real evaluateSpxPlay()/evaluateOpenPlay() + the real
// spx-play-store.ts, running spx-play-store in its already-supported in-memory
// fallback mode (dbConfigured() === false, driven by unsetting DATABASE_URL/
// DATABASE_PUBLIC_URL below) so persistence can be observed directly — via
// loadOpenPlay()/mfe_pts — without touching a real database. Modules mocked
// below are either (a) import-time singletons/live-wall-clock reads that would
// make the suite non-deterministic, or (b) fire-and-forget observational
// side channels (shadow-factor logging, adaptive-gate telemetry, Discord) that
// are irrelevant to signal_committed and whose own transitive graphs pull in
// "server-only"-guarded provider modules if left real (same reason
// admin-spx-health.test.ts mocks providers/spx-signal-log rather than
// importing it for real). Everything on the actual open-play code path —
// spx-signals, spx-play-confirmations, spx-play-mtf, spx-desk-stale,
// spx-play-thesis, spx-play-config, spx-play-store — is the genuine
// production implementation.
process.env.DATABASE_URL = "";
process.env.DATABASE_PUBLIC_URL = "";
process.env.DISCORD_PLAY_WEBHOOK_URL = "";

import { before, beforeEach, test, mock } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { PlayTechnicals } from "@/features/spx/lib/spx-play-technicals";

let mockForceExit = false;

// Avoids instantiating ws/uw-socket's module-scope `uwSocket` WebSocket manager
// singleton (spx-play-gates.ts imports shouldBlockForTradingHalt from it, and
// spx-play-engine.ts statically imports spx-play-gates.ts) — same mock shape as
// spx-play-gates.test.ts.
mock.module("../../../lib/ws/uw-socket", {
  namedExports: {
    shouldBlockForTradingHalt: () => ({ block: false, reason: null }),
  },
});

// isPastForceExitCutoff has no way to inject a fixed "now" from spx-play-engine.ts
// (it's called with zero args), so left real it would make forceExit's THETA-FLAT
// branch fire or not depending on wall-clock time when the suite happens to run —
// exactly the class of time-window bug this audit exists to catch. Mocked here for
// determinism; every other export this shared module provides (needed because both
// spx-play-engine.ts and spx-play-gates.ts import from it) is a fixed, inert default
// since neither is exercised by the open-play path under test.
mock.module("./spx-play-session-guards", {
  namedExports: {
    CASH_OPEN_ET_MINS: 9 * 60 + 30,
    getEarlyCloseMinutes: () => null,
    isEtWeekday: () => true,
    forceExitCutoffLabel: () => "3:50 PM ET",
    isPastForceExitCutoff: () => mockForceExit,
    isBeforeCashOpen: () => false,
    isPremarketPlanningWindow: () => false,
    isPastNoEntryCutoff: () => false,
    cashOpenLabel: () => "9:30 AM ET",
    noEntryCutoffLabel: () => "3:30 PM ET",
  },
});

// Shadow-mode factor logging + the retrospective snapshot log — every export
// here is dbConfigured()-guarded no-op in the real module, but the module's
// own import graph (UW/Polygon providers, BIE precedent search) pulls in
// "server-only"-guarded files that throw outside Next's server bundler. Mocked
// wholesale, same as admin-spx-health.test.ts.
mock.module("./spx-signal-log", {
  namedExports: {
    maybeLogSpxPlay: async () => {},
    logSpxShadowFactors: async () => {},
    logSpxMacroPredictionsShadowFactor: async () => {},
    logSpxSkewShadowFactors: async () => {},
    logSpxEcosystemShadowFactors: async () => {},
    logMegaCapCatalystShadowFactors: async () => {},
    logSpxPrecedentsShadowFactor: async () => {},
    maybeLogSpxEngineSnapshot: async () => {},
  },
});

// loadAdaptivePlayGates ultimately reads spx-play-outcomes.ts; irrelevant to
// signal_committed and not worth dragging in for this suite. Shape matches
// AdaptivePlayGates's "inactive" default (see spx-play-telemetry.ts).
mock.module("./spx-play-telemetry", {
  namedExports: {
    loadAdaptivePlayGates: async () => ({
      active: false,
      stats: {
        cold_buy: { count: 0, win_rate: 0 },
        watch_promote: { count: 0, win_rate: 0 },
        total_closed: 0,
        days_of_data: 0,
      },
      global_min_score_boost: 0,
      promote_min_score_boost: 0,
      promote_blocked: false,
      promote_requires_claude: false,
      promote_block_reason: null,
      summary: "adaptive gates inactive (test)",
    }),
    effectiveFullMinScore: (base: number) => base,
    effectivePromoteMinScore: (base: number) => base,
  },
});

let evaluateSpxPlay: typeof import("./spx-play-engine").evaluateSpxPlay;
let openPlay: typeof import("./spx-play-store").openPlay;
let loadOpenPlay: typeof import("./spx-play-store").loadOpenPlay;

before(async () => {
  ({ evaluateSpxPlay } = await import("./spx-play-engine"));
  ({ openPlay, loadOpenPlay } = await import("./spx-play-store"));
});

beforeEach(() => {
  mockForceExit = false;
});

const EMPTY_TECHNICALS: PlayTechnicals = {
  available: false,
  price: 0,
  m1_bars: 0,
  m3_close: null,
  m5_close: null,
  m5_ema20: null,
  m5_rsi: null,
  m5_rsi_warning: null,
  m5_trend: "flat",
  m3_above_vwap: null,
  breakout: {
    pdh_break: false,
    pdl_break: false,
    hod_break: false,
    lod_break: false,
    vwap_reclaim: false,
    vwap_lost: false,
  },
  mtf: {
    m3_confirms_long: null,
    m3_confirms_short: null,
    m5_confirms_long: false,
    m5_confirms_short: false,
  },
};

function desk(price: number, overrides: Partial<SpxDeskPayload> = {}): SpxDeskPayload {
  const now = new Date().toISOString();
  return {
    available: true,
    market_open: true,
    price,
    polled_at: now,
    as_of: now,
    source: "test",
    vix: 18,
    gex_walls: [],
    macro_events: [],
    flow_cluster_live: true,
    gex_age_ms: 1000,
    flow_data_age_ms: 1000,
    ...overrides,
  } as SpxDeskPayload;
}

/**
 * Seeds an in-memory open play (dbConfigured() is false throughout this file, so
 * spx-play-store.ts's own already-supported memory fallback holds the row — see
 * MEMORY_OPEN in spx-play-store.ts) whose entry_score equals the confluence score
 * evaluateSpxPlay will recompute against the same flat desk. Matching them exactly
 * keeps evaluateThesisBreak's drop/floor comparison a no-op (score === entryScore),
 * isolating each test to whichever exit trigger it actually sets up.
 */
async function seedOpenPlay(opts: {
  direction: "long" | "short";
  entryPrice: number;
  stop: number | null;
  target: number | null;
}) {
  const entryDesk = desk(opts.entryPrice);
  const { computeSpxConfluence } = await import("./spx-signals");
  const confluence = computeSpxConfluence(entryDesk);
  await openPlay({
    session_date: "2026-07-06",
    direction: opts.direction,
    entry_price: opts.entryPrice,
    entry_score: confluence?.score ?? 0,
    stop: opts.stop,
    target: opts.target,
    grade: "B",
    headline: "seed",
    opened_at: new Date().toISOString(),
  });
}

test("evaluateOpenPlay HOLD, mutate:false: signal_committed is false and nothing is persisted", async () => {
  await seedOpenPlay({ direction: "long", entryPrice: 5000, stop: 4950, target: 5100 });

  const payload = await evaluateSpxPlay(desk(5010), EMPTY_TECHNICALS, { mutate: false });

  assert.equal(payload.action, "HOLD");
  assert.equal(payload.signal_committed, false, "mutate:false must never claim a committed signal");

  const stillOpen = await loadOpenPlay();
  assert.ok(stillOpen, "read-only poll must not close the play");
  assert.equal(stillOpen!.mfe_pts, 0, "read-only poll must not even bump mfe/mae peaks");
});

test("evaluateOpenPlay HOLD, mutate:true: signal_committed is true and the mfe peak is actually persisted", async () => {
  await seedOpenPlay({ direction: "long", entryPrice: 5000, stop: 4950, target: 5100 });

  const payload = await evaluateSpxPlay(desk(5010), EMPTY_TECHNICALS, { mutate: true });

  assert.equal(payload.action, "HOLD");
  assert.equal(payload.signal_committed, true, "mutate:true actually wrote the mfe/mae peak — must report committed");

  const stillOpen = await loadOpenPlay();
  assert.ok(stillOpen);
  assert.equal(stillOpen!.mfe_pts, 10, "mutate:true must persist the updated mfe peak");
});

test("evaluateOpenPlay TARGET hit, mutate:false: full SELL card renders but signal_committed is false (the exact reported bug)", async () => {
  await seedOpenPlay({ direction: "long", entryPrice: 5000, stop: 4950, target: 5050 });

  const payload = await evaluateSpxPlay(desk(5060), EMPTY_TECHNICALS, { mutate: false });

  assert.equal(payload.action, "SELL");
  assert.match(payload.headline, /TARGET/);
  assert.equal(
    payload.signal_committed,
    false,
    "before the fix this was hardcoded true even though nothing was closed"
  );

  const stillOpen = await loadOpenPlay();
  assert.ok(stillOpen, "read-only poll must not actually close the play, no matter what action it renders");
});

test("evaluateOpenPlay TARGET hit, mutate:true: SELL is real — signal_committed true and the play is actually closed", async () => {
  await seedOpenPlay({ direction: "long", entryPrice: 5000, stop: 4950, target: 5050 });

  const payload = await evaluateSpxPlay(desk(5060), EMPTY_TECHNICALS, { mutate: true });

  assert.equal(payload.action, "SELL");
  assert.equal(payload.signal_committed, true);

  const stillOpen = await loadOpenPlay();
  assert.equal(stillOpen, null, "mutate:true must actually close the play");
});

// BUG FIX (2026-10-26): the closed-market SCANNING branch computed confluence off
// `desk.price > 0` alone. A cold-cache bootstrap shell (buildBootstrapFastLane() /
// deskShellFromPulse() in spx-desk-loader.ts / spx-desk.ts — a real price from the
// pulse layer, but no GEX/flow layer ever merged in, `source` left at its
// documented "none" degraded-shell marker — see the comment block in
// spx-desk-merge.ts's mergePulseIntoDesk/mergeDeskLayers) still has `available:
// true` (mergePulseIntoDesk reassigns `available: pulse.available || base
// .available`, but never reassigns `source`), so computeSpxConfluence's own
// `!desk.available` guard never fires and it returns a non-null object with
// `factors: []`/`score: 0` instead of null. `assessed: closedConfluence != null`
// then read true off that empty object — the dashboard reported "session
// assessed, grade D" for a tick the desk never actually built a real read on.
test("evaluateOpenPlay closed-market SCANNING, bootstrap-shell desk (source:none): assessed is false, not a confluence computed off an empty shell", async () => {
  const shellDesk = desk(5000, {
    market_open: false,
    source: "none",
    vwap: null,
    gamma_flip: null,
    gex_king: null,
    gex_net: null,
    tick: null,
    trin: null,
    add: null,
  });

  const payload = await evaluateSpxPlay(shellDesk, EMPTY_TECHNICALS, { mutate: false });

  assert.equal(payload.phase, "SCANNING");
  assert.equal(
    payload.assessed,
    false,
    "a source:none bootstrap shell has no real confluence to close out on — must not report assessed:true off an empty factors:[] object"
  );
  assert.deepEqual(payload.factors, []);
});

// BUG FIX (2026-10-26): the closed-market branch hand-built `gates: {blocks:["Session
// closed"], warnings:[]}` and never ran the mixed-tape sub-check that `evaluatePlayGates`
// applies on every other path — so a real closed-market response could show
// `desk_context.mixed_tape_blocked:true` (computed independently and unconditionally by
// buildSpxPlayDeskContext, spx-play-context.ts) alongside `gates.warnings:[]`, no "Tape's
// mixed" text anywhere. Confirmed live via GET /api/market/spx/play.
//
// Driving this end-to-end through the real signal engine (computeSpxConfluence) would make
// the test depend on wall-clock ET time (computeSpxConfluence's own session-quality/live-tape
// factors shift with time of day) — see spx-play-context.test.ts's "mixed-tape coherence"
// test for the deterministic behavioral proof that buildSpxPlayDeskContext and
// mixedTapeGateMessage agree on the SAME confluence-shaped data. This is the narrower,
// source-text companion (same idiom as getNhConfluenceBonus below): it pins that the
// closed-market branch actually WIRES mixedTapeGateMessage's result into gates.warnings,
// which that behavioral test alone cannot catch — it only exercises the two shared
// functions in isolation, not whether spx-play-engine.ts's closed-market branch still calls
// either of them.
test("evaluateSpxPlayCore closed-market branch runs the shared mixed-tape check and wires it into gates.warnings", () => {
  const src = readFileSync(fileURLToPath(new URL("./spx-play-engine.ts", import.meta.url)), "utf8");
  const start = src.indexOf("if (!desk.market_open && !premarket) {");
  assert.ok(start > 0, "closed-market branch exists");
  const end = src.indexOf("\n  const technicals =", start);
  assert.ok(end > start, "closed-market branch's early-return block ends before the open-market path resumes");
  const body = src.slice(start, end);
  assert.match(
    body,
    /mixedTapeGateMessage\(closedConfluence\)/,
    "closed-market branch must run the shared mixed-tape sub-check, not skip it entirely"
  );
  assert.match(
    body,
    /warnings:\s*mixedTapeMsg\s*!=\s*null\s*\?\s*\[mixedTapeMsg\]\s*:\s*\[\]/,
    "gates.warnings must surface the mixed-tape message instead of being hardcoded to []"
  );
});

// BUG FIX (2026-10-26, Ask Largo/5-engine standing mandate, live repro): the closed-market
// SCANNING branch serves a GEX-derived factor/play-idea built from `desk.gex_walls`, which on
// this path peekMergedSpxDesk() deliberately tolerates up to 24h stale (an intentional,
// unchanged design choice — "once the market is genuinely closed, stale and correct are the same
// thing"). The bug was that the factor/play-idea/thesis never consulted desk.gex_stale before
// presenting a specific GEX level, so a member saw "At 0DTE support node 7675 (+5 pts)" with zero
// indication it could be hours old. Live repro: the sibling GET /api/market/spx/desk route
// (peekSpxDesk(), NOT 24h-tolerant) reported gex_stale:true/gex_walls:[] at virtually the same
// instant /play served this exact idea undisclosed.
function closedDeskWithGexSupport(overrides: Partial<SpxDeskPayload> = {}): SpxDeskPayload {
  return desk(7680, {
    market_open: false,
    source: "test",
    gex_walls: [{ strike: 7675, net_gex: 500_000, kind: "support", distance_pts: 5 }],
    ...overrides,
  });
}

test("evaluateOpenPlay closed-market SCANNING, desk.gex_stale:true: the GEX-derived factor/thesis/play-idea disclose staleness", async () => {
  const stalePayload = await evaluateSpxPlay(
    closedDeskWithGexSupport({ gex_stale: true, gex_age_ms: 26 * 3_600_000 }),
    EMPTY_TECHNICALS,
    { mutate: false }
  );

  assert.equal(stalePayload.phase, "SCANNING");
  const gexFactor = stalePayload.factors.find(
    (f) => f.label === "GEX support" || f.label === "GEX resistance"
  );
  assert.ok(gexFactor, "fixture must actually fire a GEX-derived factor to test disclosure on");
  assert.match(
    gexFactor!.detail,
    /GEX stale, not live/,
    "a GEX-derived factor built from stale desk data must disclose it rather than present a specific level as if live"
  );
  assert.match(
    stalePayload.thesis,
    /GEX stale, not live/,
    "the closed-market thesis must also carry the staleness clause"
  );
  assert.ok(stalePayload.gates.play_idea, "fixture must produce a play idea to test disclosure on");
  assert.match(stalePayload.gates.play_idea!, /GEX stale, not live/);
});

test("evaluateOpenPlay closed-market SCANNING, desk.gex_stale:false (or absent): the SAME GEX-derived factor renders unchanged, with no staleness disclosure", async () => {
  const freshPayload = await evaluateSpxPlay(
    closedDeskWithGexSupport({ gex_stale: false, gex_age_ms: 1000 }),
    EMPTY_TECHNICALS,
    { mutate: false }
  );
  const freshGexFactor = freshPayload.factors.find(
    (f) => f.label === "GEX support" || f.label === "GEX resistance"
  );
  assert.ok(freshGexFactor);
  assert.doesNotMatch(freshGexFactor!.detail, /GEX stale/);
  assert.doesNotMatch(freshPayload.thesis, /GEX stale/);
  assert.ok(freshPayload.gates.play_idea);
  assert.doesNotMatch(freshPayload.gates.play_idea!, /GEX stale/);

  // gex_stale entirely absent from the desk payload must behave identically to explicit false —
  // this is the live production shape (older/degraded desk snapshots may never set the field).
  const absentPayload = await evaluateSpxPlay(
    closedDeskWithGexSupport(),
    EMPTY_TECHNICALS,
    { mutate: false }
  );
  const absentGexFactor = absentPayload.factors.find(
    (f) => f.label === "GEX support" || f.label === "GEX resistance"
  );
  assert.ok(absentGexFactor);
  assert.doesNotMatch(absentGexFactor!.detail, /GEX stale/);
  assert.doesNotMatch(absentPayload.thesis, /GEX stale/);
});

// BUG FIX (2026-10-31, Ask Largo/5-engine standing mandate, live repro — Saturday, market
// closed): same bug class as the GEX staleness disclosure above, for the VWAP factor instead.
// The closed-market branch's "VWAP" factor is built straight off `desk.vwap`, which on this path
// can be a cross-request sticky "last-known-good" fallback (spx-desk-merge.ts's
// mergePulseIntoDesk -> stickyStructureLevel) serving a prior session's VWAP INDEFINITELY once
// both pulse.vwap and base.vwap go null (any non-trading day) — with nothing on the desk
// disclosing it before `vwap_stale` (spx-desk.ts/spx-desk-merge.ts) was added alongside this
// fix. Live repro: GET /api/market/spx/play served a "VWAP" factor (weight -12, "Below VWAP
// 7580.87 — sellers pressing") contributing to the closed-market score/grade on a Saturday,
// while the sibling GET /api/market/spx/desk route (peekSpxDesk(), no sticky merge) correctly
// reported vwap:null at the same instant.
function closedDeskWithVwap(overrides: Partial<SpxDeskPayload> = {}): SpxDeskPayload {
  return desk(7500, {
    market_open: false,
    source: "test",
    vwap: 7580.87,
    ...overrides,
  });
}

test("evaluateOpenPlay closed-market SCANNING, desk.vwap_stale:true: the VWAP factor/thesis/play-idea disclose staleness", async () => {
  const stalePayload = await evaluateSpxPlay(
    closedDeskWithVwap({ vwap_stale: true }),
    EMPTY_TECHNICALS,
    { mutate: false }
  );

  assert.equal(stalePayload.phase, "SCANNING");
  const vwapFactor = stalePayload.factors.find((f) => f.label === "VWAP");
  assert.ok(vwapFactor, "fixture must actually fire a VWAP factor to test disclosure on");
  assert.match(
    vwapFactor!.detail,
    /VWAP stale, not live/,
    "a VWAP factor built from a sticky-fallback vwap must disclose it rather than present a prior session's level as if live"
  );
  assert.match(
    stalePayload.thesis,
    /VWAP stale, not live/,
    "the closed-market thesis must also carry the VWAP staleness clause"
  );
  assert.ok(stalePayload.gates.play_idea, "fixture must produce a play idea to test disclosure on");
  assert.match(stalePayload.gates.play_idea!, /VWAP stale, not live/);
});

test("evaluateOpenPlay closed-market SCANNING, desk.vwap_stale:false (or absent): the SAME VWAP factor renders unchanged, with no staleness disclosure", async () => {
  const freshPayload = await evaluateSpxPlay(
    closedDeskWithVwap({ vwap_stale: false }),
    EMPTY_TECHNICALS,
    { mutate: false }
  );
  const freshVwapFactor = freshPayload.factors.find((f) => f.label === "VWAP");
  assert.ok(freshVwapFactor);
  assert.doesNotMatch(freshVwapFactor!.detail, /VWAP stale/);
  assert.doesNotMatch(freshPayload.thesis, /VWAP stale/);
  assert.ok(freshPayload.gates.play_idea);
  assert.doesNotMatch(freshPayload.gates.play_idea!, /VWAP stale/);

  // vwap_stale entirely absent from the desk payload must behave identically to explicit false —
  // the live production shape whenever vwap came from a fresh pulse/base read this cycle.
  const absentPayload = await evaluateSpxPlay(
    closedDeskWithVwap(),
    EMPTY_TECHNICALS,
    { mutate: false }
  );
  const absentVwapFactor = absentPayload.factors.find((f) => f.label === "VWAP");
  assert.ok(absentVwapFactor);
  assert.doesNotMatch(absentVwapFactor!.detail, /VWAP stale/);
  assert.doesNotMatch(absentPayload.thesis, /VWAP stale/);
});

// Proves the two disclosure checks are independent and COMPOSE rather than one overwriting the
// other — a closed-market read that's stale on both the GEX wall and the VWAP level at once
// must disclose both clauses, not just whichever check happened to run last.
test("evaluateOpenPlay closed-market SCANNING, BOTH desk.gex_stale and desk.vwap_stale true: both staleness clauses are disclosed together", async () => {
  const bothStalePayload = await evaluateSpxPlay(
    closedDeskWithGexSupport({
      gex_stale: true,
      gex_age_ms: 26 * 3_600_000,
      vwap: 7580.87,
      vwap_stale: true,
    }),
    EMPTY_TECHNICALS,
    { mutate: false }
  );

  const gexFactor = bothStalePayload.factors.find(
    (f) => f.label === "GEX support" || f.label === "GEX resistance"
  );
  const vwapFactor = bothStalePayload.factors.find((f) => f.label === "VWAP");
  assert.ok(gexFactor, "fixture must fire a GEX-derived factor");
  assert.ok(vwapFactor, "fixture must fire a VWAP factor");
  assert.match(gexFactor!.detail, /GEX stale, not live/);
  assert.match(vwapFactor!.detail, /VWAP stale, not live/);
  assert.match(bothStalePayload.thesis, /GEX stale, not live/);
  assert.match(bothStalePayload.thesis, /VWAP stale, not live/);
  assert.ok(bothStalePayload.gates.play_idea);
  assert.match(bothStalePayload.gates.play_idea!, /GEX stale, not live/);
  assert.match(bothStalePayload.gates.play_idea!, /VWAP stale, not live/);
});

// BUG FIX (2026-10-31, Ask Largo/5-engine standing mandate, live repro — Saturday, market
// closed): same bug class as the GEX/VWAP staleness disclosure above, for flow/tape-derived
// factors instead. The closed-market branch's "0DTE flow" factor is built straight off
// `desk.flow_0dte_net` with no freshness check at all — unlike GEX/VWAP, there was never even a
// boolean on the desk payload for this; `desk.flow_data_age_ms` was read nowhere in this branch
// (only in a debug log elsewhere). Live repro: GET /api/market/spx/play served a +14-weight
// "0DTE flow" factor ("Call premium leading 0DTE tape") — 35% of the published score of 40 — on
// a Saturday whose `flow_data_age_ms` the sibling GET /api/market/spx/desk route reported as
// ~17.4h (62,672,013ms) old, with zero disclosure anywhere in the response.
function closedDeskWithFlowNet(overrides: Partial<SpxDeskPayload> = {}): SpxDeskPayload {
  return desk(7500, {
    market_open: false,
    source: "test",
    flow_0dte_net: 500_000,
    ...overrides,
  });
}

test("evaluateOpenPlay closed-market SCANNING, stale flow (age past threshold, no live cluster heartbeat): the 0DTE-flow factor/thesis/play-idea disclose staleness", async () => {
  const stalePayload = await evaluateSpxPlay(
    closedDeskWithFlowNet({ flow_data_age_ms: 62_672_013, flow_cluster_live: false }),
    EMPTY_TECHNICALS,
    { mutate: false }
  );

  assert.equal(stalePayload.phase, "SCANNING");
  const flowFactor = stalePayload.factors.find((f) => f.label === "0DTE flow");
  assert.ok(flowFactor, "fixture must actually fire the 0DTE-flow factor to test disclosure on");
  assert.match(
    flowFactor!.detail,
    /Flow stale, not live/,
    "a flow-derived factor built from hours-old flow data must disclose it rather than present it as if live"
  );
  assert.match(
    stalePayload.thesis,
    /Flow stale, not live/,
    "the closed-market thesis must also carry the flow staleness clause"
  );
  assert.ok(stalePayload.gates.play_idea, "fixture must produce a play idea to test disclosure on");
  assert.match(stalePayload.gates.play_idea!, /Flow stale, not live/);
});

test("evaluateOpenPlay closed-market SCANNING, fresh flow (age below threshold): the SAME 0DTE-flow factor renders unchanged, with no staleness disclosure", async () => {
  const freshPayload = await evaluateSpxPlay(
    closedDeskWithFlowNet({ flow_data_age_ms: 1000, flow_cluster_live: true }),
    EMPTY_TECHNICALS,
    { mutate: false }
  );
  const freshFlowFactor = freshPayload.factors.find((f) => f.label === "0DTE flow");
  assert.ok(freshFlowFactor);
  assert.doesNotMatch(freshFlowFactor!.detail, /Flow stale/);
  assert.doesNotMatch(freshPayload.thesis, /Flow stale/);
  assert.ok(freshPayload.gates.play_idea);
  assert.doesNotMatch(freshPayload.gates.play_idea!, /Flow stale/);

  // Old age but a live SPX/SPXW flow-cohort heartbeat (flow_cluster_live:true) must also NOT
  // disclose — the exact same "another replica is delivering a live frame" override the live
  // BUY-intent gate (isFlowDataStale, spx-play-gates.ts) already respects.
  const liveClusterPayload = await evaluateSpxPlay(
    closedDeskWithFlowNet({ flow_data_age_ms: 62_672_013, flow_cluster_live: true }),
    EMPTY_TECHNICALS,
    { mutate: false }
  );
  const liveClusterFlowFactor = liveClusterPayload.factors.find((f) => f.label === "0DTE flow");
  assert.ok(liveClusterFlowFactor);
  assert.doesNotMatch(liveClusterFlowFactor!.detail, /Flow stale/);
  assert.doesNotMatch(liveClusterPayload.thesis, /Flow stale/);
});

// Proves the three disclosure checks are independent and COMPOSE rather than one overwriting
// another — a closed-market read that's stale on GEX, VWAP, AND flow at once must disclose all
// three clauses, not just whichever check happened to run last.
test("evaluateOpenPlay closed-market SCANNING, GEX + VWAP + flow all stale: all three staleness clauses are disclosed together", async () => {
  const allStalePayload = await evaluateSpxPlay(
    desk(7680, {
      market_open: false,
      source: "test",
      gex_walls: [{ strike: 7675, net_gex: 500_000, kind: "support", distance_pts: 5 }],
      gex_stale: true,
      gex_age_ms: 26 * 3_600_000,
      vwap: 7580.87,
      vwap_stale: true,
      flow_0dte_net: 500_000,
      flow_data_age_ms: 62_672_013,
      flow_cluster_live: false,
    }),
    EMPTY_TECHNICALS,
    { mutate: false }
  );

  const gexFactor = allStalePayload.factors.find(
    (f) => f.label === "GEX support" || f.label === "GEX resistance"
  );
  const vwapFactor = allStalePayload.factors.find((f) => f.label === "VWAP");
  const flowFactor = allStalePayload.factors.find((f) => f.label === "0DTE flow");
  assert.ok(gexFactor, "fixture must fire a GEX-derived factor");
  assert.ok(vwapFactor, "fixture must fire a VWAP factor");
  assert.ok(flowFactor, "fixture must fire the 0DTE-flow factor");
  assert.match(gexFactor!.detail, /GEX stale, not live/);
  assert.match(vwapFactor!.detail, /VWAP stale, not live/);
  assert.match(flowFactor!.detail, /Flow stale, not live/);
  assert.match(allStalePayload.thesis, /GEX stale, not live/);
  assert.match(allStalePayload.thesis, /VWAP stale, not live/);
  assert.match(allStalePayload.thesis, /Flow stale, not live/);
  assert.ok(allStalePayload.gates.play_idea);
  assert.match(allStalePayload.gates.play_idea!, /GEX stale, not live/);
  assert.match(allStalePayload.gates.play_idea!, /VWAP stale, not live/);
  assert.match(allStalePayload.gates.play_idea!, /Flow stale, not live/);
});

// BUG FIX (2026-09-03): getNhConfluenceBonus's staleness check used a raw
// `(Date.now() - publishedAt.getTime()) / 3_600_000 > 20` comparison. published_at is written by a
// SEPARATE Night Hawk cron process, so cross-process clock skew is real — a future-dated edition
// produced a negative ageHours that never exceeded 20, letting an untrustworthy edition be used as
// a valid morning prior instead of being rejected. getNhConfluenceBonus is unexported and reads
// live DB state, so this is a source-text regression guard (same idiom as HelixTideBar.test.ts /
// db.test.ts's SQL CASE checks) rather than a full behavioral test.
test("getNhConfluenceBonus: staleness check uses isZeroDteMarkStale, not a raw age subtraction", () => {
  const src = readFileSync(fileURLToPath(new URL("./spx-play-engine.ts", import.meta.url)), "utf8");
  const start = src.indexOf("async function getNhConfluenceBonus");
  assert.ok(start > 0, "getNhConfluenceBonus exists");
  const end = src.indexOf("\nasync function", start + 1);
  const body = src.slice(start, end > 0 ? end : undefined);
  assert.match(
    body,
    /isZeroDteMarkStale\(publishedAt\.getTime\(\), Date\.now\(\), 20 \* 3_600_000\)/,
    "must route through the shared future-timestamp-guarded staleness predicate"
  );
});
