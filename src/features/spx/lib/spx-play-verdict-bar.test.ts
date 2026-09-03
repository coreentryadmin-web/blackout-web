import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlayVerdictBarModel } from "./spx-play-verdict-bar";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";

function basePlay(overrides: Partial<SpxPlayPayload> = {}): SpxPlayPayload {
  return {
    available: true,
    phase: "SCANNING",
    action: "SCANNING",
    direction: "long",
    grade: "B",
    score: 52,
    confidence: 0.6,
    headline: "Scanning — no A+ setup yet.",
    thesis: "Pinned between walls — wait for break.",
    idle_message: "Scanning — no A+ setup yet.",
    factors: [],
    levels: { entry: 7440, stop: 7425, target: 7465, invalidation: "7420 break" },
    gates: {
      passed: false,
      blocks: ["Score below full entry floor (52 < 68)"],
      warnings: [],
      entry_mode: "none",
      play_idea: "Leaning Calls — 7450 Call could be the play off above VWAP 7432",
    },
    claude: null,
    cortex: null,
    open_play: null,
    confirmations: null,
    technicals: null,
    mtf: null,
    option_ticket: null,
    watch: null,
    telemetry: null,
    lotto_play: null,
    power_play: null,
    session_phase: "cash",
    signal_committed: false,
    as_of: new Date().toISOString(),
    ...overrides,
  };
}

test("buildPlayVerdictBarModel: hunting shows gate block and play idea", () => {
  const model = buildPlayVerdictBarModel(basePlay(), { sessionActive: true, loading: false });
  assert.equal(model.mode, "hunting");
  assert.equal(model.badge, "HUNTING");
  assert.match(model.gateLine ?? "", /Score below full entry floor/);
  assert.match(model.detailLine ?? "", /7450 Call/);
  assert.equal(model.topGateBlockers.length, 1);
  assert.match(model.topGateBlockers[0] ?? "", /Score below full entry floor/);
});

test("buildPlayVerdictBarModel: open play surfaces contract, levels, and est PnL", () => {
  const model = buildPlayVerdictBarModel(
    basePlay({
      phase: "OPEN",
      action: "HOLD",
      open_play: {
        id: 1,
        direction: "long",
        entry_price: 7437,
        stop: 7425,
        target: 7465,
        grade: "A",
        opened_at: new Date().toISOString(),
        mfe_pts: 4.2,
        trim_done: false,
        option_label: "7450C",
        option_premium: "5.2",
        option_pnl_est: {
          spot_move_pts: 2,
          delta_pnl: 0.7,
          gamma_pnl: 0.1,
          theta_pnl: -0.05,
          spread_cost: 0.1,
          net_premium_pnl: 0.65,
          model: "delta_gamma_theta_lite",
          modeled: false,
          modeled_fields: [],
        },
      },
    }),
    { sessionActive: true, loading: false }
  );
  assert.equal(model.mode, "open");
  assert.equal(model.badge, "OPEN");
  assert.equal(model.contract, "7450C @ 5.2");
  assert.match(model.levelsLine ?? "", /entry 7,437/);
  assert.match(model.pnlLabel ?? "", /\+\$0\.65/);
});

test("buildPlayVerdictBarModel: watch mode prefers watch reason", () => {
  const model = buildPlayVerdictBarModel(
    basePlay({
      phase: "WATCHING",
      action: "WATCHING",
      watch: { active: true, promote_ready: false, reason: "Break above 7450 call wall", since: null },
    }),
    { sessionActive: true, loading: false }
  );
  assert.equal(model.mode, "watch");
  assert.equal(model.badge, "WATCH");
  assert.equal(model.statusLine, "Break above 7450 call wall");
});

test("buildPlayVerdictBarModel: session active with SCANNING play stays hunting (not CLOSED)", () => {
  const model = buildPlayVerdictBarModel(
    basePlay({ action: "SCANNING", phase: "SCANNING", session_phase: "cash" }),
    { sessionActive: true, loading: false }
  );
  assert.notEqual(model.mode, "closed");
  assert.equal(model.badge, "HUNTING");
});

test("buildPlayVerdictBarModel: closed only when session inactive or play session_phase closed", () => {
  const activeScan = buildPlayVerdictBarModel(basePlay(), { sessionActive: true, loading: false });
  assert.notEqual(activeScan.mode, "closed");

  const inactive = buildPlayVerdictBarModel(basePlay(), { sessionActive: false, loading: false });
  assert.equal(inactive.mode, "closed");

  const sessionClosed = buildPlayVerdictBarModel(
    basePlay({ session_phase: "closed" }),
    { sessionActive: true, loading: false }
  );
  assert.equal(sessionClosed.mode, "closed");
});

test("buildPlayVerdictBarModel: missing levels does not throw (degraded play path)", () => {
  const { levels: _omit, ...withoutLevels } = basePlay();
  const model = buildPlayVerdictBarModel(withoutLevels as SpxPlayPayload, {
    sessionActive: true,
    loading: false,
  });
  assert.equal(model.mode, "hunting");
  assert.equal(model.levelsLine, null);
});

test("buildPlayVerdictBarModel: WATCH without option_ticket does NOT fabricate index entry as 7606C", () => {
  const model = buildPlayVerdictBarModel(
    basePlay({
      phase: "WATCHING",
      action: "WATCHING",
      direction: "long",
      levels: { entry: 7606.2, stop: 7590, target: 7630, invalidation: "" },
      option_ticket: null,
      watch: { active: true, promote_ready: false, reason: "Break above call wall", since: null },
    }),
    { sessionActive: true, loading: false }
  );
  assert.equal(model.mode, "watch");
  assert.equal(model.contract, null);
});

test("buildPlayVerdictBarModel: grounded option_ticket surfaces real strike", () => {
  const model = buildPlayVerdictBarModel(
    basePlay({
      phase: "WATCHING",
      action: "WATCHING",
      direction: "long",
      option_ticket: {
        underlying: "SPXW",
        strike: 7610,
        option_type: "call",
        contract_label: "7610C",
        ticker: "O:SPXW260804C07610000",
        bid: 4.5,
        ask: 4.8,
        mid: 4.65,
        spread_pct: 6.5,
        delta: 0.42,
        open_interest: 1200,
        premium_range: "4.50–4.80",
        blocked: false,
        block_reason: null,
      },
    }),
    { sessionActive: true, loading: false }
  );
  assert.equal(model.contract, "7610C @ 4.7");
});

test("buildPlayVerdictBarModel: pin/play divergence surfaces align hint", () => {
  const model = buildPlayVerdictBarModel(
    basePlay({ direction: "long" }),
    {
      sessionActive: true,
      loading: false,
      pin: {
        available: true,
        magnet: { strike: 7580, kind: "put_wall", direction: "down", strengthPct: 0.4 },
      } as never,
    }
  );
  assert.match(model.alignHint ?? "", /downward pin drift/i);
  assert.match(model.alignHint ?? "", /bullish structure/i);
});

// ---------------------------------------------------------------------------
// Absence must not be published as a measurement (Largo product contract, pt 3).
// scanningPayload(desk, null, …) fabricates grade "D" / score 0 when NO confluence was computed,
// and both literals pass the old guards ("D" is truthy, 0 is finite), so the bar rendered
// "Grade D · 0" on a desk that had assessed nothing. `assessed:false` is the discriminator.
// ---------------------------------------------------------------------------

test("buildPlayVerdictBarModel: assessed:false suppresses the fabricated D/0 grade", () => {
  const model = buildPlayVerdictBarModel(
    basePlay({ assessed: false, grade: "D", score: 0, confidence: 0 }),
    { sessionActive: true, loading: false }
  );
  assert.equal(model.mode, "hunting");
  assert.equal(model.grade, null, "no confluence was computed — there is no grade to show");
  assert.equal(model.score, null, "0 is the placeholder literal, not a measured score");
  // The member still gets a reason; only the invented number is withheld.
  assert.ok(model.statusLine.length > 0);
});

test("buildPlayVerdictBarModel: assessed:false still surfaces a REAL grade off an open position", () => {
  // A committed position's grade was measured when it was opened, so it survives the suppression.
  const model = buildPlayVerdictBarModel(
    basePlay({
      assessed: false,
      grade: "D",
      score: 0,
      phase: "OPEN",
      action: "HOLD",
      open_play: {
        id: 9,
        direction: "long",
        entry_price: 7440,
        stop: 7425,
        target: 7465,
        grade: "A",
        opened_at: new Date().toISOString(),
        mfe_pts: 3,
        trim_done: false,
      },
    }),
    { sessionActive: true, loading: false }
  );
  assert.equal(model.grade, "A");
  assert.equal(model.score, null, "the payload score is still a placeholder");
});

test("buildPlayVerdictBarModel: assessed absent (legacy payload) keeps the measured grade", () => {
  // Back-compat: only an EXPLICIT false means absence. An older payload with no flag is trusted.
  const model = buildPlayVerdictBarModel(basePlay({ grade: "B", score: 52 }), {
    sessionActive: true,
    loading: false,
  });
  assert.equal(model.grade, "B");
  assert.equal(model.score, 52);
});

test("buildPlayVerdictBarModel: assessed:true passes the measured grade through unchanged", () => {
  const model = buildPlayVerdictBarModel(
    basePlay({ assessed: true, grade: "A+", score: 81 }),
    { sessionActive: true, loading: false }
  );
  assert.equal(model.grade, "A+");
  assert.equal(model.score, 81);
});
