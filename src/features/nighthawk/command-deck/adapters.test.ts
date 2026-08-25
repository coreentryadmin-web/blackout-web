import { test } from "node:test";
import assert from "node:assert/strict";
import {
  terminalPlayFromZeroDte,
  terminalPlayFromHorizon,
  terminalPlayFromEdition,
  managementFor,
  parseLevelNum,
  firstSeenIso,
} from "./adapters.ts";
import { overlayLegacyQuotes } from "./use-legacy-quotes.ts";

test("managementFor: RATCHET progress maps -50→0, +100→1; recommendations by P&L", () => {
  assert.equal(managementFor("RATCHET", "OPEN", -50).progress, 0);
  assert.equal(managementFor("RATCHET", "OPEN", 100).progress, 1);
  assert.ok(Math.abs(managementFor("RATCHET", "OPEN", 25).progress! - 0.5) < 1e-9);
  assert.equal(managementFor("RATCHET", "OPEN", 100).recommendation, "TRIM"); // doubled → take partial
  assert.equal(managementFor("RATCHET", "OPEN", -48).recommendation, "SELL"); // near stop
  assert.equal(managementFor("RATCHET", "TRIM", 30).recommendation, "TRIM"); // status wins
  assert.equal(managementFor("SCALE_OUT", "OPEN", 20).progress, null); // tranches, not a track
});

test("managementFor: WATCH/SKIP are candidate-only — no ratchet progress or position management", () => {
  const watch = managementFor("RATCHET", "WATCH", 50);
  assert.equal(watch.recommendation, "HOLD");
  assert.equal(watch.progress, null);
  assert.match(watch.recNote, /Candidate only/);

  const skip = managementFor("RATCHET", "SKIP", -40);
  assert.equal(skip.recommendation, "HOLD");
  assert.equal(skip.progress, null);
  assert.match(skip.recNote, /Gate blocked/);
});

test("0DTE adapter: rich factors from flow-quality, RATCHET model, allocation + pnl", () => {
  const play = terminalPlayFromZeroDte({
    ticker: "nvda",
    strike: 192,
    status: "OPEN",
    score: 88,
    live_pnl_pct: 64,
    entry_premium: 4.2,
    last_mark: 6.9,
    peak_premium: 7.4,
    trough_premium: 3.9,
    setup: {
      direction: "long",
      dte: 0,
      gamma_regime: "positive",
      flow_quality: { components: { premiumDepth: 20, aggression: 18, sweepIntensity: 16, momentum: 12 } },
      gate: { verdict: "COMMIT", blocks: [] },
      plan: { occ: "O:NVDA260724C00192000" },
      market_aligned: true,
    },
    allocation: { role: "PRIMARY", sizing: "FULL", reasons: ["rank #1 · primary semis"] },
  });
  assert.equal(play.ticker, "NVDA");
  assert.equal(play.direction, "LONG");
  assert.equal(play.contract, "192C · 0DTE");
  assert.equal(play.exitModel, "RATCHET");
  assert.equal(play.factors[0]!.label, "Premium Depth"); // biggest lever leads
  assert.equal(play.gates.find((g) => g.label === "Hard gate")!.ok, true);
  assert.equal(play.allocation!.role, "PRIMARY");
  assert.equal(play.occ, "O:NVDA260724C00192000");
  assert.equal(play.peak, 76); // (7.4/4.2 - 1) * 100
  assert.ok(Math.abs(play.progress! - (64 + 50) / 150) < 1e-9);
});

test("0DTE adapter: lost tape alignment surfaces a thesis-break warning", () => {
  const play = terminalPlayFromZeroDte({
    ticker: "SPY", strike: 584, status: "TRIM", score: 74, live_pnl_pct: 31,
    setup: { direction: "short", dte: 0, market_aligned: false, gate: { verdict: "COMMIT" } },
  });
  assert.equal(play.direction, "SHORT");
  assert.equal(play.contract, "584P · 0DTE");
  assert.equal(play.thesisBreak!.level, "warn");
  assert.match(play.thesisBreak!.note!, /alignment lost/);
});

test("horizon adapter: SCALE_OUT model, reason as note, mid as mark", () => {
  const play = terminalPlayFromHorizon({
    ticker: "pltr", direction: "LONG", horizon: "SWING", score: 77, reason: "momentum 90%, accumulation 88%",
    contract: { strike: 52, right: "C", expiry: "2026-08-07", dte: 14, mid: 2.32 },
  });
  assert.equal(play.horizon, "SWING");
  assert.equal(play.exitModel, "SCALE_OUT");
  assert.equal(play.contract, "52C · 14DTE");
  assert.equal(play.mark, 2.32);
  assert.match(play.recNote!, /momentum 90%/);
  assert.equal(play.progress, null); // scale-out → tranches, no ratchet track
});

test("horizon adapter (PR-12 de-hardcode): real factors/regime/thesisBreak flow from the serving meta", () => {
  const play = terminalPlayFromHorizon({
    ticker: "pltr", direction: "LONG", horizon: "SWING", score: 77, status: "WATCH",
    contract: { strike: 52, right: "C", expiry: "2026-08-07", dte: 14, mid: 2.32 },
    factors: [{ label: "Structure", points: 24 }, { label: "Flow", points: 15 }],
    regime: "Breakout continuation · regime 0.60",
    thesisBreak: { level: "warn", note: "thin read — 3/7 pillars grounded" },
  });
  assert.equal(play.factors[0]!.label, "Structure"); // real pillar contributions, no longer []
  assert.equal(play.regime, "Breakout continuation · regime 0.60"); // no longer null
  assert.equal(play.thesisBreak!.level, "warn"); // no longer a hardcoded 'intact'
});

test("horizon adapter (PR-12): thesisBreak DERIVES from setupState; INVALIDATED → break", () => {
  const invalid = terminalPlayFromHorizon({
    ticker: "x", direction: "LONG", horizon: "SWING", score: 61, setupState: "INVALIDATED",
    contract: { strike: 10, right: "C", expiry: "2026-08-07", dte: 14 },
  });
  assert.equal(invalid.thesisBreak!.level, "break");
  const live = terminalPlayFromHorizon({
    ticker: "y", direction: "LONG", horizon: "SWING", score: 61, setupState: "TRIGGERED",
    contract: { strike: 10, right: "C", expiry: "2026-08-07", dte: 14 },
  });
  assert.equal(live.thesisBreak!.level, "intact");
});

test("horizon adapter (PR-12): LEAPS / un-enriched caller is UNCHANGED — legacy literals preserved", () => {
  // No swing reads supplied (the live LEAPS path): factors []/regime null/thesisBreak intact — exactly as before.
  const play = terminalPlayFromHorizon({
    ticker: "aapl", direction: "LONG", horizon: "LEAPS", score: 70,
    contract: { strike: 200, right: "C", expiry: "2026-10-16", dte: 84, mid: 12.5 },
  });
  assert.deepEqual(play.factors, []);
  assert.equal(play.regime, null);
  assert.equal(play.thesisBreak!.level, "intact");
});

test("edition adapter: dossier factors, PLAN model, WATCH status (no morning confirm)", () => {
  const play = terminalPlayFromEdition({
    ticker: "AAPL", direction: "long", rank: 1, score: 82,
    factor_breakdown: { flow: 30, tech: 22, positioning: 16, smart_money: 10, news: 0 },
  });
  assert.equal(play.horizon, "LEGACY");
  assert.equal(play.exitModel, "PLAN");
  assert.equal(play.status, "WATCH");
  assert.equal(play.factors[0]!.label, "Flow");
  assert.ok(!play.factors.some((f) => f.label === "News")); // 0 dropped
  assert.equal(play.contract, "Rank 1 · next session"); // no options_play → rank fallback
});

// ════════════════════════════════════════════════════════════════════════════════════
// Enriched Legacy (edition) adapter — entry parsing, morning confirm, gates, pulled
// ════════════════════════════════════════════════════════════════════════════════════

test("edition adapter: parseEntryMid from entry_range (two-price range → midpoint)", () => {
  const play = terminalPlayFromEdition({
    ticker: "NVDA", direction: "long", rank: 1, score: 75,
    entry_range: "$192.50 – $195.00",
  });
  assert.equal(play.entry, 193.75);
});

test("edition adapter: stock entry mid drives entry; option premium on entryCostPerContract", () => {
  const play = terminalPlayFromEdition({
    ticker: "AAPL", direction: "long", rank: 2, score: 80,
    entry_range: "$190.00 – $195.00",
    entry_premium: 3.5,
  });
  assert.equal(play.entry, 192.5);
  assert.equal(play.entryCostPerContract, 3.5);
});

test("edition adapter: options_play replaces rank-based contract label", () => {
  const play = terminalPlayFromEdition({
    ticker: "TSLA", direction: "long", rank: 3, score: 70,
    options_play: "Aug 15 $260 Call",
  });
  assert.equal(play.contract, "Aug 15 $260 Call");
});

test("edition adapter: morning CONFIRMED → status OPEN, regime 'pre-market CONFIRMED', thesis intact", () => {
  const play = terminalPlayFromEdition({
    ticker: "META", direction: "long", rank: 1, score: 85,
    morning_status: "CONFIRMED",
  });
  assert.equal(play.status, "OPEN");
  assert.equal(play.regime, "pre-market CONFIRMED");
  assert.equal(play.thesisBreak!.level, "intact");
  assert.match(play.recNote!, /confirmed/i);
  assert.equal(play.recommendation, "BUY", "CONFIRMED morning status → BUY recommendation");
});

test("edition adapter: morning INVALIDATED → status SKIP, thesis break, recommendation SELL", () => {
  const play = terminalPlayFromEdition({
    ticker: "AMD", direction: "long", rank: 2, score: 60,
    morning_status: "INVALIDATED",
    morning_reason: "gap down through stop level",
  });
  assert.equal(play.status, "SKIP");
  assert.equal(play.thesisBreak!.level, "break");
  assert.match(play.thesisBreak!.note!, /gap down/);
  assert.equal(play.recommendation, "SELL");
  assert.equal(play.regime, "INVALIDATED — pulled");
});

test("edition adapter: morning DEGRADED → status WATCH, thesis warn", () => {
  const play = terminalPlayFromEdition({
    ticker: "COIN", direction: "long", rank: 3, score: 55,
    morning_status: "DEGRADED",
    morning_reason: "crypto sentiment shifted overnight",
  });
  assert.equal(play.status, "WATCH");
  assert.equal(play.thesisBreak!.level, "warn");
  assert.match(play.recNote!, /DEGRADED/);
});

test("edition adapter: pulled play → status CLOSED, thesis break, recommendation SELL", () => {
  const play = terminalPlayFromEdition({
    ticker: "BABA", direction: "long", rank: 4, score: 50,
    pulled: true,
    pulled_reason: "earnings pre-announcement risk",
  });
  assert.equal(play.status, "CLOSED");
  assert.equal(play.thesisBreak!.level, "break");
  assert.match(play.thesisBreak!.note!, /earnings/);
  assert.equal(play.recommendation, "SELL");
  assert.match(play.recNote!, /PULLED/);
});

test("edition adapter: INVALIDATED that also carries pulled=true (the real morning-verdict-persist latch) still shows the exact invalidated copy, not the generic pulled fallback", () => {
  // morning-verdict-persist.ts's INVALIDATED verdict always engages the one-way `pulled` latch, so
  // both fields are true together in production — checking `pulled` before `ms === "INVALIDATED"`
  // would silently shadow this exact, member-requested copy with the generic pulled_reason text.
  const play = terminalPlayFromEdition({
    ticker: "AMD", direction: "long", rank: 2, score: 60,
    pulled: true,
    pulled_reason: "gate: INVALIDATED (morning confirm)",
    morning_status: "INVALIDATED",
    morning_reason: "gap down through stop level",
  });
  assert.equal(play.thesisBreak!.level, "break");
  assert.match(play.thesisBreak!.note!, /^The play has been invalidated at pre-market screening/);
  assert.match(play.thesisBreak!.note!, /gap down through stop level/);
  assert.match(play.recNote!, /^The play has been invalidated at pre-market screening/);
  assert.equal(play.recommendation, "SELL");
});

test("edition adapter: CONFIRMED + swing_promoted → swingPromoted true and recNote says 'moved to Swings Open'", () => {
  const play = terminalPlayFromEdition({
    ticker: "CRWV", direction: "long", rank: 1, score: 80,
    morning_status: "CONFIRMED",
    swing_promoted: true,
  });
  assert.equal(play.swingPromoted, true);
  assert.match(play.recNote!, /the play is still active and moved to Swings Open/);
});

test("edition adapter: CONFIRMED but NOT promoted (e.g. 'no chain rows') → swingPromoted false, generic confirmed recNote", () => {
  const play = terminalPlayFromEdition({
    ticker: "SKHY", direction: "long", rank: 1, score: 80,
    morning_status: "CONFIRMED",
    swing_promoted: false,
  });
  assert.equal(play.swingPromoted, false);
  assert.match(play.recNote!, /thesis intact, entry levels hold/);
  assert.doesNotMatch(play.recNote!, /Swings Open/);
});

test("edition adapter: gate_promoted with gate_warnings → gates array with ok:false entries", () => {
  const play = terminalPlayFromEdition({
    ticker: "SHOP", direction: "long", rank: 1, score: 72,
    gate_promoted: true,
    gate_warnings: ["band_detached", "stale_quote_basis"],
  });
  assert.equal(play.gates.length, 2);
  assert.equal(play.gates[0]!.label, "band_detached");
  assert.equal(play.gates[0]!.ok, false);
  assert.equal(play.gates[1]!.label, "stale_quote_basis");
});

test("edition adapter: gate_promoted false with warnings → no gates surfaced", () => {
  const play = terminalPlayFromEdition({
    ticker: "PLTR", direction: "long", rank: 2, score: 65,
    gate_promoted: false,
    gate_warnings: ["band_detached"],
  });
  assert.equal(play.gates.length, 0);
});

test("edition adapter: exit_style 'scale_out' → exitModel SCALE_OUT", () => {
  const play = terminalPlayFromEdition({
    ticker: "MSTR", direction: "long", rank: 1, score: 78,
    exit_style: "scale_out",
  });
  assert.equal(play.exitModel, "SCALE_OUT");
});

test("edition adapter: thesis text used as recNote when no morning status", () => {
  const play = terminalPlayFromEdition({
    ticker: "SOFI", direction: "long", rank: 1, score: 70,
    thesis: "Fintech breakout on strong Q2 guidance above consensus",
  });
  assert.match(play.recNote!, /Fintech breakout/);
});

test("edition adapter: tier factors threaded from publish-context tier blob", () => {
  const play = terminalPlayFromEdition({
    ticker: "NVDA", direction: "long", rank: 1, score: 48, conviction: "A",
    tier: {
      tier: "A",
      factors: [
        { label: "Prime score band", direction: "up" as const, detail: "Score 48 sits in 40-54." },
        { label: "Strong signal breadth", direction: "up" as const, detail: "4 of 9 dimensions confirming." },
      ],
    },
  });
  assert.equal(play.tierLabel, "A");
  assert.equal(play.tierFactors?.length, 2);
  assert.equal(play.tierFactors![0].label, "Prime score band");
  assert.equal(play.tierFactors![0].direction, "up");
  assert.equal(play.tierFactors![1].label, "Strong signal breadth");
});

test("edition adapter: tierLabel falls back to conviction when tier blob is absent", () => {
  const play = terminalPlayFromEdition({
    ticker: "AMD", direction: "long", rank: 1, score: 50, conviction: "B",
  });
  assert.equal(play.tierLabel, "B");
  assert.equal(play.tierFactors, null);
});

test("0DTE adapter: committed OPEN with aged-out gate context still passes the Hard gate (9-6b)", () => {
  // A refresh-lane committed play whose setup.gate aged to null must NOT render '✗ Hard gate'.
  const play = terminalPlayFromZeroDte({
    ticker: "nvda", strike: 190, status: "OPEN", score: 80, live_pnl_pct: 12, entry_premium: 4, last_mark: 4.5,
    setup: { direction: "long", gate: null, market_aligned: null },
  });
  const hard = play.gates.find((g) => g.label === "Hard gate")!;
  assert.equal(hard.ok, true); // working status passes even with null gate
});

test("0DTE adapter: null tape-alignment is UNKNOWN — not a green tape-align gate nor 'intact' (9-6c)", () => {
  const play = terminalPlayFromZeroDte({
    ticker: "amd", strike: 170, status: "WATCH", score: 66,
    setup: { direction: "long", gate: { verdict: "WATCH" }, market_aligned: null },
  });
  const tape = play.gates.find((g) => g.label === "Tape align")!;
  assert.equal(tape.ok, false); // null is not a confirmed pass
  assert.equal(play.thesisBreak?.level, "unknown"); // neither intact nor degrading
});

test("0DTE adapter: market_aligned false → warn 'tape alignment lost'; true → intact + tape-align ok", () => {
  const lost = terminalPlayFromZeroDte({ ticker: "x", status: "WATCH", setup: { direction: "long", market_aligned: false } });
  assert.equal(lost.thesisBreak?.level, "warn");
  const aligned = terminalPlayFromZeroDte({ ticker: "y", status: "WATCH", setup: { direction: "long", market_aligned: true } });
  assert.equal(aligned.thesisBreak?.level, "intact");
  assert.equal(aligned.gates.find((g) => g.label === "Tape align")!.ok, true);
});

// ════════════════════════════════════════════════════════════════════════════════════
// EDGE/BOUNDARY expansion — every render-state path through terminalPlayFromZeroDte and
// the managementFor truth table. Each case asserts a real branch, not filler.
// ════════════════════════════════════════════════════════════════════════════════════

const hardGate = (p: ReturnType<typeof terminalPlayFromZeroDte>) => p.gates.find((g) => g.label === "Hard gate")!;
const tapeGate = (p: ReturnType<typeof terminalPlayFromZeroDte>) => p.gates.find((g) => g.label === "Tape align")!;

// ── Hard gate across EVERY status × gate-verdict combination (9-6b) ────────────────────
// isCommitted = OPEN|HOLD|TRIM|CLOSED. Hard gate ok = (verdict==="COMMIT") OR isCommitted.
// CLOSED must never re-litigate today's refresh-lane BLOCKED gate (prod SPY 2026-07-28).
test("0DTE adapter: Hard gate ok for EVERY working status even with a null gate (refresh-lane)", () => {
  for (const status of ["OPEN", "HOLD", "TRIM"] as const) {
    const p = terminalPlayFromZeroDte({ ticker: "nvda", status, setup: { direction: "long", gate: null } });
    assert.equal(hardGate(p).ok, true, `${status} + null gate must pass the Hard gate`);
    assert.equal(p.status, status);
  }
});

test("0DTE adapter: WATCH/SKIP fails the Hard gate unless gate verdict is COMMIT", () => {
  for (const status of ["WATCH", "SKIP"] as const) {
    const blocked = terminalPlayFromZeroDte({ ticker: "amd", status, setup: { direction: "long", gate: { verdict: "WATCH" } } });
    assert.equal(hardGate(blocked).ok, false, `${status} + non-COMMIT gate must fail the Hard gate`);
    const committed = terminalPlayFromZeroDte({ ticker: "amd", status, setup: { direction: "long", gate: { verdict: "COMMIT" } } });
    assert.equal(hardGate(committed).ok, true, `${status} + COMMIT gate passes the Hard gate`);
  }
});

test("0DTE adapter: CLOSED always passes Hard gate (committed — never re-litigate refresh BLOCKED)", () => {
  const blocked = terminalPlayFromZeroDte({
    ticker: "spy", status: "CLOSED",
    setup: { direction: "long", gate: { verdict: "BLOCKED" } },
  });
  assert.equal(hardGate(blocked).ok, true);
  const nullGate = terminalPlayFromZeroDte({ ticker: "meta", status: "CLOSED", setup: { direction: "long", gate: null } });
  assert.equal(hardGate(nullGate).ok, true);
});

// ── direction / contract label (long=C, short=P) + strike & dte fallbacks ──────────────
test("0DTE adapter: SHORT put uses P and the setup top_strike when src.strike is absent", () => {
  const p = terminalPlayFromZeroDte({ ticker: "spx", status: "OPEN", setup: { direction: "short", dte: 0, top_strike: 6300 } });
  assert.equal(p.direction, "SHORT");
  assert.equal(p.contract, "6300P · 0DTE"); // strike from setup.top_strike, right P
});

test("0DTE adapter: missing strike → '?', non-zero dte → 'NDTE', null dte → '?DTE'", () => {
  const noStrike = terminalPlayFromZeroDte({ ticker: "x", status: "OPEN", setup: { direction: "long", dte: 2 } });
  assert.equal(noStrike.contract, "?C · 2DTE"); // strike unknown, 2-day contract
  const nullDte = terminalPlayFromZeroDte({ ticker: "y", strike: 100, status: "OPEN", setup: { direction: "long" } });
  assert.equal(nullDte.contract, "100C · ?DTE"); // dte absent
});

test("0DTE adapter: src.strike takes precedence over setup.top_strike", () => {
  const p = terminalPlayFromZeroDte({ ticker: "z", strike: 500, status: "OPEN", setup: { direction: "long", dte: 0, top_strike: 999 } });
  assert.equal(p.contract, "500C · 0DTE");
});

test("0DTE adapter: thesis_first on setup surfaces as thesisFirst on TerminalPlay", () => {
  const thesisFirst = {
    thesis: {
      ticker: "NVDA",
      direction: "long" as const,
      rail_scores: { FLOW: 88, BREAKOUT: 84 },
      rails_fired: ["FLOW", "BREAKOUT"] as const,
      systems_aligned: 2,
      trade_archetype: "BREAKOUT" as const,
      archetype_score: 82,
      structural_state: "TRIGGERED" as const,
      trigger_price: 181.5,
      summaries: {},
    },
    archetype_gates: { verdict: "PASS" as const, archetype: "BREAKOUT" as const, blocks: [], notes: [] },
    expression: null,
    rank_tier: "A" as const,
  };
  const p = terminalPlayFromZeroDte({
    ticker: "nvda",
    status: "WATCH",
    setup: { direction: "long", dte: 0, thesis_first: thesisFirst },
  });
  assert.equal(p.thesisFirst?.rank_tier, "A");
  assert.equal(p.thesisFirst?.thesis.systems_aligned, 2);
});

// ── missing setup entirely ─────────────────────────────────────────────────────────────
test("0DTE adapter: NO setup at all — defaults to LONG, empty factors, unknown thesis, gate driven by status", () => {
  const working = terminalPlayFromZeroDte({ ticker: "nvda", status: "HOLD", live_pnl_pct: 10, entry_premium: 4, last_mark: 4.4 });
  assert.equal(working.direction, "LONG"); // asDir(undefined) → LONG
  assert.deepEqual(working.factors, []); // no flow_quality, no factor_breakdown
  assert.equal(working.regime, null); // no gamma_regime
  assert.equal(working.occ, null); // no plan.occ
  assert.equal(working.thesisBreak?.level, "unknown"); // market_aligned absent → unknown, never a fabricated intact
  assert.equal(hardGate(working).ok, true); // HOLD is working
  assert.equal(tapeGate(working).ok, false); // no true alignment read

  const idle = terminalPlayFromZeroDte({ ticker: "amd", status: "WATCH" });
  assert.equal(hardGate(idle).ok, false); // WATCH + no gate → not a pass
});

// ── factors: flow_quality wins; null flow_quality → factor_breakdown fallback ──────────
test("0DTE adapter: null flow_quality falls back to factor_breakdown (0/non-number dropped, labels mapped)", () => {
  const p = terminalPlayFromZeroDte({
    ticker: "nvda", status: "OPEN",
    setup: {
      direction: "long",
      flow_quality: null, // no components → fall back
      factor_breakdown: { flow: 30, tech: 22, positioning: 0, news: 8, smart_money: 5 },
    },
  });
  const labels = p.factors.map((f) => f.label);
  assert.ok(labels.includes("Flow") && labels.includes("Technicals") && labels.includes("Positioning") === false);
  assert.ok(!p.factors.some((f) => f.points === 0)); // 0-point positioning dropped
  assert.equal(p.factors.find((f) => f.label === "Smart Money")!.points, 5); // FB_LABELS mapping applied
});

test("0DTE adapter: empty flow_quality components object yields NO factors (still wins over factor_breakdown)", () => {
  // flow_quality.components present-but-empty is truthy → factorsFromFlowQuality([]) path, NOT the fallback.
  const p = terminalPlayFromZeroDte({
    ticker: "x", status: "OPEN",
    setup: { direction: "long", flow_quality: { components: {} }, factor_breakdown: { flow: 30 } },
  });
  assert.deepEqual(p.factors, []); // the fallback factor_breakdown is NOT consulted when components exists
});

test("0DTE adapter: unknown factor_breakdown key passes through as its own label", () => {
  const p = terminalPlayFromZeroDte({ ticker: "x", status: "OPEN", setup: { direction: "long", factor_breakdown: { unmapped_key: 9 } } });
  assert.equal(p.factors[0]!.label, "unmapped_key"); // FB_LABELS[k] ?? k
});

// ── thesis / tape-align truth table across market_aligned true/false/null ──────────────
test("0DTE adapter: market_aligned truth table → intact/warn/unknown + tape gate ok only on true", () => {
  const t = terminalPlayFromZeroDte({ ticker: "a", status: "OPEN", setup: { direction: "long", market_aligned: true } });
  assert.equal(t.thesisBreak?.level, "intact");
  assert.equal(tapeGate(t).ok, true);

  const f = terminalPlayFromZeroDte({ ticker: "b", status: "OPEN", setup: { direction: "long", market_aligned: false } });
  assert.equal(f.thesisBreak?.level, "warn");
  assert.equal(tapeGate(f).ok, false);

  const n = terminalPlayFromZeroDte({ ticker: "c", status: "OPEN", setup: { direction: "long", market_aligned: null } });
  assert.equal(n.thesisBreak?.level, "unknown");
  assert.equal(tapeGate(n).ok, false);
});

// ── peak / trough excursion math + entry-null / entry-zero guards ──────────────────────
test("0DTE adapter: peak/trough = round((premium/entry − 1) × 100); null when entry or premium missing", () => {
  const p = terminalPlayFromZeroDte({
    ticker: "nvda", status: "TRIM", entry_premium: 4.2, last_mark: 6.9, peak_premium: 7.4, trough_premium: 3.9,
    setup: { direction: "long" },
  });
  assert.equal(p.peak, 76); // round((7.4/4.2 − 1)×100) = round(76.19)
  assert.equal(p.trough, -7); // round((3.9/4.2 − 1)×100) = round(−7.14)
  assert.equal(p.entry, 4.2);
  assert.equal(p.mark, 6.9);
});

test("0DTE adapter: entry null → entry/peak/trough all null (no divide by a missing basis)", () => {
  const p = terminalPlayFromZeroDte({ ticker: "x", status: "WATCH", peak_premium: 5, trough_premium: 1, setup: { direction: "long" } });
  assert.equal(p.entry, null);
  assert.equal(p.peak, null);
  assert.equal(p.trough, null);
});

test("0DTE adapter: entry 0 is falsy → peak/trough null (no divide-by-zero)", () => {
  const p = terminalPlayFromZeroDte({ ticker: "x", status: "OPEN", entry_premium: 0, peak_premium: 5, trough_premium: 2, setup: { direction: "long" } });
  assert.equal(p.entry, 0); // fin(0) === 0 → surfaced as 0
  assert.equal(p.peak, null); // entry falsy guard
  assert.equal(p.trough, null);
});

test("0DTE adapter: peak present but trough missing → only trough is null", () => {
  const p = terminalPlayFromZeroDte({ ticker: "x", status: "HOLD", entry_premium: 2, peak_premium: 3, setup: { direction: "long" } });
  assert.equal(p.peak, 50); // round((3/2 − 1)×100)
  assert.equal(p.trough, null);
});

// ── mark / pnl / score / regime / occ passthrough + non-finite guards ──────────────────
test("0DTE adapter: non-finite mark/pnl/score become null/0; NaN never leaks", () => {
  const p = terminalPlayFromZeroDte({
    ticker: "x", status: "OPEN", score: Number.NaN, live_pnl_pct: Number.POSITIVE_INFINITY, last_mark: Number.NaN,
    setup: { direction: "long" },
  });
  assert.equal(p.score, 0); // fin(NaN) ?? 0
  assert.equal(p.pnlPct, null); // fin(Infinity) → null
  assert.equal(p.mark, null); // fin(NaN) → null
});

test("0DTE adapter: gamma_regime → 'gamma <x>' label; occ from plan; id and ticker upcased", () => {
  const p = terminalPlayFromZeroDte({
    ticker: "nvda", status: "OPEN", score: 87.6,
    setup: { direction: "long", gamma_regime: "negative", plan: { occ: "O:NVDA260724C00190000" } },
  });
  assert.equal(p.regime, "gamma negative");
  assert.equal(p.occ, "O:NVDA260724C00190000");
  assert.equal(p.id, "0DTE:nvda"); // id keeps the raw ticker
  assert.equal(p.ticker, "NVDA"); // display upcased
  assert.equal(p.score, 88); // rounded
});

// ── stockPrice / rrRatio / optionsPlay enrichment ────────────────────────────────────
test("0DTE adapter: directional play surfaces stockPrice from underlying_price", () => {
  const p = terminalPlayFromZeroDte({
    ticker: "AAPL", status: "WATCH", score: 70,
    setup: { direction: "long" },
    underlying_price: 215.50,
  });
  assert.equal(p.stockPrice, 215.50);
});

test("0DTE adapter: condor play does NOT surface stockPrice (uses tent spot)", () => {
  const p = terminalPlayFromZeroDte({
    ticker: "SPX", status: "OPEN", score: 80,
    setup: { direction: "short", play_type: "CONDOR" },
    underlying_price: 5500,
  });
  assert.equal(p.stockPrice, null);
});

test("0DTE adapter: R:R computed from plan stop/target premiums", () => {
  const p = terminalPlayFromZeroDte({
    ticker: "TSLA", status: "WATCH", score: 65,
    setup: { direction: "long", plan: { stop_premium: 2.0, target_premium: 6.0 } },
  });
  assert.equal(p.rrRatio, 2.0); // (6−2)/2 = 2.0
});

test("0DTE adapter: R:R null when plan missing or stop/target absent", () => {
  const noplan = terminalPlayFromZeroDte({ ticker: "X", status: "WATCH", setup: { direction: "long" } });
  assert.equal(noplan.rrRatio, null);
  const partial = terminalPlayFromZeroDte({ ticker: "X", status: "WATCH", setup: { direction: "long", plan: { stop_premium: 2.0 } } });
  assert.equal(partial.rrRatio, null);
});

test("0DTE adapter: optionsPlay from plan OCC", () => {
  const p = terminalPlayFromZeroDte({
    ticker: "NVDA", status: "WATCH", score: 75,
    setup: { direction: "long", plan: { occ: "O:NVDA260728C00130000" } },
  });
  assert.equal(p.optionsPlay, "O:NVDA260728C00130000");
});

test("0DTE adapter: src.occ keys the marks overlay when setup.plan is absent (ledger-only)", () => {
  const p = terminalPlayFromZeroDte({
    ticker: "SPY", status: "OPEN", score: 74, last_mark: 2.26, entry_premium: 2.12,
    occ: "O:SPY260729C00742000",
    setup: { direction: "long", dte: 0, top_strike: 742 },
  });
  assert.equal(p.occ, "O:SPY260729C00742000");
  assert.equal(p.optionsPlay, "O:SPY260729C00742000");
  assert.equal(p.mark, 2.26);
});

// ── allocation mapping (first reason only) + absence ───────────────────────────────────
test("0DTE adapter: allocation maps role/sizing + the FIRST reason; absent allocation → null", () => {
  const withAlloc = terminalPlayFromZeroDte({
    ticker: "x", status: "OPEN", setup: { direction: "long" },
    allocation: { role: "PRIMARY", sizing: "FULL", reasons: ["rank #1", "secondary reason"] },
  });
  assert.deepEqual(withAlloc.allocation, { role: "PRIMARY", sizing: "FULL", reason: "rank #1" });
  const noAlloc = terminalPlayFromZeroDte({ ticker: "y", status: "OPEN", setup: { direction: "long" } });
  assert.equal(noAlloc.allocation, null);
});

test("0DTE adapter: allocation with empty reasons array → reason undefined (no crash on [0])", () => {
  const p = terminalPlayFromZeroDte({ ticker: "x", status: "OPEN", setup: { direction: "long" }, allocation: { role: "R", sizing: "S", reasons: [] } });
  assert.equal(p.allocation!.reason, undefined);
});

// ── status normalization: garbage → WATCH; case-insensitive ────────────────────────────
test("0DTE adapter: unrecognized status string normalizes to WATCH; lowercase status upcases", () => {
  const garbage = terminalPlayFromZeroDte({ ticker: "x", status: "banana", setup: { direction: "long" } });
  assert.equal(garbage.status, "WATCH");
  const lower = terminalPlayFromZeroDte({ ticker: "y", status: "open", setup: { direction: "long" } });
  assert.equal(lower.status, "OPEN");
});

test("0DTE adapter: always exitModel RATCHET and horizon ZERO_DTE; RATCHET progress present", () => {
  const p = terminalPlayFromZeroDte({ ticker: "x", status: "OPEN", live_pnl_pct: 25, entry_premium: 1, last_mark: 1.25, setup: { direction: "long" } });
  assert.equal(p.exitModel, "RATCHET");
  assert.equal(p.horizon, "ZERO_DTE");
  assert.ok(Math.abs(p.progress! - (25 + 50) / 150) < 1e-9); // RATCHET track filled from pnl
});

// ════════════════════════════════════════════════════════════════════════════════════
// managementFor — the full truth table (exit model × status × pnl band).
// ════════════════════════════════════════════════════════════════════════════════════

test("managementFor: TRIM status wins over EVERY pnl band and model", () => {
  for (const model of ["RATCHET", "SCALE_OUT", "PLAN"] as const) {
    for (const pnl of [-50, -45, 0, 89, 90, 200]) {
      assert.equal(managementFor(model, "TRIM", pnl).recommendation, "TRIM", `${model} TRIM @${pnl}`);
    }
  }
});

test("managementFor: RATCHET at ≥90 (non-TRIM status) → TRIM at the boundary, HOLD just below", () => {
  assert.equal(managementFor("RATCHET", "OPEN", 90).recommendation, "TRIM"); // boundary inclusive
  assert.equal(managementFor("RATCHET", "HOLD", 89).recommendation, "HOLD"); // just below
  // A non-RATCHET model does NOT auto-TRIM on a big winner (scale-out banks via tranches, not here).
  assert.equal(managementFor("SCALE_OUT", "OPEN", 95).recommendation, "HOLD");
  assert.equal(managementFor("PLAN", "OPEN", 300).recommendation, "HOLD");
});

test("managementFor: SELL at ≤−45 boundary; HOLD at −44; TRIM state still beats SELL", () => {
  assert.equal(managementFor("RATCHET", "OPEN", -45).recommendation, "SELL"); // boundary inclusive
  assert.equal(managementFor("RATCHET", "OPEN", -44).recommendation, "HOLD");
  assert.equal(managementFor("RATCHET", "TRIM", -50).recommendation, "TRIM"); // TRIM status precedence
});

test("managementFor: null pnl → treated as 0 → HOLD, RATCHET progress = 1/3", () => {
  const m = managementFor("RATCHET", "OPEN", null);
  assert.equal(m.recommendation, "HOLD");
  assert.ok(Math.abs(m.progress! - (0 + 50) / 150) < 1e-9);
});

test("managementFor: RATCHET progress clamps to [0,1] beyond −50%/+100%", () => {
  assert.equal(managementFor("RATCHET", "OPEN", -50).progress, 0);
  assert.equal(managementFor("RATCHET", "OPEN", -80).progress, 0); // clamped low
  assert.equal(managementFor("RATCHET", "OPEN", 100).progress, 1);
  assert.equal(managementFor("RATCHET", "OPEN", 250).progress, 1); // clamped high
  assert.equal(managementFor("SCALE_OUT", "OPEN", 50).progress, null); // no ratchet track
  assert.equal(managementFor("PLAN", "OPEN", 50).progress, null);
});

test("managementFor: recNote reflects the recommendation + model", () => {
  assert.match(managementFor("RATCHET", "OPEN", -50).recNote, /preserve capital/); // SELL
  assert.match(managementFor("SCALE_OUT", "TRIM", 10).recNote, /Bank a tranche/); // SCALE_OUT trim
  assert.match(managementFor("RATCHET", "TRIM", 10).recNote, /Take partial/); // ratchet trim
  assert.match(managementFor("RATCHET", "HOLD", 20).recNote, /In profit/); // HOLD in the green
  assert.match(managementFor("RATCHET", "HOLD", -10).recNote, /Managing to the plan/); // HOLD underwater
});

// ── Terminal v2 — trim-scale ladder routing, live greeks/executable, header badges ──

const TRIM_SCALE_LADDER = {
  policy: "trim_scale" as const,
  hard_stop_pct: -50,
  target_pct: 100,
  trim_levels: [
    { trigger_pct: 25, fraction: 1 / 3, premium: 2.5, fired: true },
    { trigger_pct: 50, fraction: 1 / 3, premium: 3.0, fired: false },
  ],
  runner_fraction: 1 / 3,
  stop_premium: 1.0,
  target_premium: 4.0,
  time_stop_et: "15:30",
};

test("0DTE adapter: a trim_scale frozen policy routes to SCALE_OUT + carries the real ladder", () => {
  const play = terminalPlayFromZeroDte({
    ticker: "nvda", strike: 182, status: "OPEN", score: 88, live_pnl_pct: 30,
    entry_premium: 2.0, last_mark: 2.6, peak_premium: 2.6,
    setup: { direction: "long", dte: 0 },
    exit_policy: TRIM_SCALE_LADDER,
  });
  assert.equal(play.exitModel, "SCALE_OUT"); // NOT the old hard-coded RATCHET
  assert.equal(play.exitPolicy!.policy, "trim_scale");
  assert.equal(play.exitPolicy!.trim_levels[0]!.fired, true);
  assert.equal(play.exitPolicy!.trim_levels[1]!.fired, false);
  assert.equal(play.exitPolicy!.target_premium, 4.0);
});

test("0DTE adapter: a ratchet frozen policy (or none) keeps RATCHET single-track", () => {
  const ratchet = terminalPlayFromZeroDte({
    ticker: "amd", strike: 165, status: "OPEN", score: 70, live_pnl_pct: 10,
    entry_premium: 1.2, last_mark: 1.3,
    setup: { direction: "short", dte: 0 },
    exit_policy: { ...TRIM_SCALE_LADDER, policy: "ratchet" },
  });
  assert.equal(ratchet.exitModel, "RATCHET");
  assert.equal(ratchet.progress != null, true); // ratchet track position present

  const none = terminalPlayFromZeroDte({
    ticker: "amd", strike: 165, status: "OPEN", score: 70, live_pnl_pct: 10,
    entry_premium: 1.2, last_mark: 1.3, setup: { direction: "short", dte: 0 },
  });
  assert.equal(none.exitModel, "RATCHET"); // legacy row, no policy → unchanged
  assert.equal(none.exitPolicy, null);
});

test("0DTE adapter: maps live greeks, executable fill, mark honesty, and header badges", () => {
  const play = terminalPlayFromZeroDte({
    ticker: "nvda", strike: 182, status: "OPEN", score: 88, live_pnl_pct: 30,
    entry_premium: 2.0, last_mark: 2.6, bid: 2.55, ask: 2.65, live_pnl_pct_exec: 27.5,
    greeks: { delta: 0.52, gamma: 0.06, theta: -0.18, vega: 0.11, iv: 0.44 },
    mark_as_of: "2026-07-25T14:00:00.000Z", mark_is_sync: false,
    discovery_origin: ["FLOW", "BREAKOUT"], tier: { tier: "A" }, confluence: 2,
    setup: { direction: "long", dte: 0 },
  });
  assert.equal(play.greeks!.theta, -0.18);
  assert.equal(play.execMark, 2.55); // sells into the bid, not the 2.60 mid
  assert.equal(play.execPnlPct, 27.5);
  assert.equal(play.markAsOf, "2026-07-25T14:00:00.000Z");
  assert.equal(play.markIsSync, false);
  assert.deepEqual(play.discoveryOrigin, ["FLOW", "BREAKOUT"]);
  assert.equal(play.tierLabel, "A");
  assert.equal(play.confluence, 2);
});

test("0DTE adapter: greeks/executable/badges are null-safe when absent (never fabricated)", () => {
  const play = terminalPlayFromZeroDte({
    ticker: "spy", strike: 584, status: "WATCH", score: 60,
    setup: { direction: "long", dte: 0 },
  });
  assert.equal(play.greeks, null);
  assert.equal(play.execMark, null);
  assert.equal(play.execPnlPct, null);
  assert.equal(play.discoveryOrigin, null);
  assert.equal(play.tierLabel, null);
  assert.equal(play.confluence, null);
  assert.equal(play.scorecard, null);
});

test("0DTE adapter: one-sided book → executable fill null (mid-only, no fake fill)", () => {
  const play = terminalPlayFromZeroDte({
    ticker: "nvda", strike: 182, status: "OPEN", score: 80, live_pnl_pct: 10,
    entry_premium: 2.0, last_mark: 2.2, ask: 2.3, bid: null, // one-sided
    setup: { direction: "long", dte: 0 },
  });
  assert.equal(play.execMark, null);
});

test("0DTE adapter: a CONDOR row is flagged isCondor and NEVER routes to the directional trim ladder", () => {
  // Even if the frozen policy says trim_scale, a credit condor must not draw the long-premium ladder.
  const condor = terminalPlayFromZeroDte({
    ticker: "spx", strike: 6300, status: "HOLD", score: 82, live_pnl_pct: 40,
    entry_premium: 4.2, last_mark: 2.4, is_condor: true,
    setup: { direction: "short", dte: 0, play_type: "CONDOR" },
    exit_policy: TRIM_SCALE_LADDER,
  });
  assert.equal(condor.isCondor, true);
  assert.equal(condor.exitModel, "RATCHET"); // NOT SCALE_OUT — the directional ladder is suppressed

  // Condor detected from the setup's play_type when the row lacks an explicit is_condor flag.
  const fromSetup = terminalPlayFromZeroDte({
    ticker: "spxw", status: "OPEN", score: 70,
    setup: { direction: "short", dte: 0, play_type: "CONDOR" },
    exit_policy: TRIM_SCALE_LADDER,
  });
  assert.equal(fromSetup.isCondor, true);
  assert.equal(fromSetup.exitModel, "RATCHET");

  // A directional trim_scale row is unaffected — still routes to SCALE_OUT + the real ladder.
  const directional = terminalPlayFromZeroDte({
    ticker: "nvda", status: "OPEN", score: 80, entry_premium: 2.0, last_mark: 2.6,
    setup: { direction: "long", dte: 0 }, exit_policy: TRIM_SCALE_LADDER,
  });
  assert.equal(directional.isCondor, null);
  assert.equal(directional.exitModel, "SCALE_OUT");
});

// ── Wave 2: condor render geometry + seller-framed P&L ───────────────────────────────

const CONDOR_GEOM = {
  spot: 6300, short_put: 6250, long_put: 6200, short_call: 6350, long_call: 6400, wing_pts: 50,
  net_credit: 420, max_loss: 4580, breach_lower: 6250, breach_upper: 6350,
  est_win_rate: 92, est_intraday_breach_pct: 18.7,
};

test("0DTE adapter (condor): DISPLAYS the server's seller-framed P&L verbatim — no double-invert (FINDINGS 2026-07-26)", () => {
  // The SERVER now computes live_pnl_pct seller-framed (reconcileLedgerLivePnlPct): sold at 4.2
  // credit, marking 1.0 → (4.2−1.0)/4.2 = +76.2%, POSITIVE, arriving on the payload. The render must
  // DISPLAY it, never re-invert it — the Wave 2 seller recompute (which would flip +76.2 back to a
  // wrong sign) is removed. This test feeds the CORRECT server value and asserts it survives intact.
  const winner = terminalPlayFromZeroDte({
    ticker: "spx", status: "HOLD", score: 82, is_condor: true,
    entry_premium: 4.2, last_mark: 1.0, live_pnl_pct: 76.2,
    peak_premium: 4.5, trough_premium: 0.9,
    setup: { direction: "short", dte: 0, play_type: "CONDOR" },
    condor: CONDOR_GEOM, underlying_price: 6301,
  });
  assert.equal(winner.pnlPct, 76.2); // server value displayed as-is (positive) — NOT re-inverted to −76.2
  // peak = BEST excursion = lowest mark (0.9): (4.2−0.9)/4.2 = +78.6%; trough = worst (highest 4.5): −7.1%.
  // These derive from the RAW latched premiums on the payload (not from live_pnl_pct), so they are a
  // display transform, not a second invert of the corrected headline.
  assert.equal(winner.peak, 78.6);
  assert.equal(winner.trough, -7.1);
});

test("0DTE adapter (condor): NO double-invert — a correct positive server P&L is never flipped negative", () => {
  // Regression lock for the removed Wave 2 recompute: if the render still derived (entry−mark)/entry
  // AND the server also did, a positive winner would round-trip to negative. Feed a correct positive
  // server value with a low mark and assert the sign is preserved exactly.
  const positive = terminalPlayFromZeroDte({
    ticker: "spx", status: "HOLD", is_condor: true,
    entry_premium: 4.2, last_mark: 0.5, live_pnl_pct: 88.1,
    setup: { direction: "short", dte: 0, play_type: "CONDOR" },
    condor: CONDOR_GEOM,
  });
  assert.equal(positive.pnlPct, 88.1); // preserved, positive — not re-flipped
  // A breached (losing) condor arrives NEGATIVE from the server and must also stay negative.
  const loser = terminalPlayFromZeroDte({
    ticker: "spx", status: "HOLD", is_condor: true,
    entry_premium: 4.2, last_mark: 9.0, live_pnl_pct: -114.3,
    setup: { direction: "short", dte: 0, play_type: "CONDOR" },
    condor: CONDOR_GEOM,
  });
  assert.equal(loser.pnlPct, -114.3); // preserved, negative
});

test("0DTE adapter (condor): executable-fill P&L is suppressed (directional long framing is inverted)", () => {
  const condor = terminalPlayFromZeroDte({
    ticker: "spx", status: "HOLD", score: 82, is_condor: true,
    entry_premium: 4.2, last_mark: 1.0, bid: 0.98, ask: 1.02, live_pnl_pct_exec: -76.6,
    setup: { direction: "short", dte: 0, play_type: "CONDOR" },
    condor: CONDOR_GEOM,
  });
  assert.equal(condor.execMark, null);
  assert.equal(condor.execPnlPct, null);
});

test("0DTE adapter (condor): maps the tent geometry; spot resolves to the LIVE underlying + flags it", () => {
  const condor = terminalPlayFromZeroDte({
    ticker: "spx", status: "OPEN", score: 80, is_condor: true, entry_premium: 4.2, last_mark: 3.0,
    setup: { direction: "short", dte: 0, play_type: "CONDOR" },
    condor: CONDOR_GEOM, underlying_price: 6288,
  });
  assert.ok(condor.condor);
  assert.equal(condor.condor!.shortPut, 6250);
  assert.equal(condor.condor!.shortCall, 6350);
  assert.equal(condor.condor!.breachLower, 6250);
  assert.equal(condor.condor!.breachUpper, 6350);
  assert.equal(condor.condor!.netCredit, 420);
  assert.equal(condor.condor!.winRate, 92);
  assert.equal(condor.condor!.breachRatePct, 18.7);
  assert.equal(condor.condor!.spot, 6288); // live underlying wins
  assert.equal(condor.condor!.spotIsLive, true);
});

test("0DTE adapter (condor): no live underlying → falls back to commit spot, spotIsLive=false", () => {
  const condor = terminalPlayFromZeroDte({
    ticker: "spx", status: "OPEN", score: 80, is_condor: true, entry_premium: 4.2, last_mark: 3.0,
    setup: { direction: "short", dte: 0, play_type: "CONDOR" },
    condor: CONDOR_GEOM, // no underlying_price
  });
  assert.equal(condor.condor!.spot, 6300); // commit spot fallback
  assert.equal(condor.condor!.spotIsLive, false);
});

test("0DTE adapter (condor): a condor with no pinned geometry → condor null (honest, no fabricated tent)", () => {
  const condor = terminalPlayFromZeroDte({
    ticker: "spx", status: "OPEN", score: 80, is_condor: true, entry_premium: 4.2, last_mark: 3.0,
    setup: { direction: "short", dte: 0, play_type: "CONDOR" },
    // no condor blob
  });
  assert.equal(condor.isCondor, true);
  assert.equal(condor.condor, null);
});

test("0DTE adapter: a DIRECTIONAL row never gets condor geometry (condor null)", () => {
  const dir = terminalPlayFromZeroDte({
    ticker: "nvda", status: "OPEN", score: 80, entry_premium: 2.0, last_mark: 2.6, live_pnl_pct: 30,
    setup: { direction: "long", dte: 0 }, condor: CONDOR_GEOM, // even if a blob leaks in
  });
  assert.equal(dir.condor, null); // not a condor → never built
  assert.equal(dir.pnlPct, 30); // directional P&L unchanged (from the live_pnl_pct path)
});

// ── Wave 3 edge layer: why-now, first-flag time, scorecard CI passthrough ──────────────
test("0DTE adapter (Wave 3): why_now + first_flagged_at map through to whyNow/firstFlaggedAt", () => {
  const p = terminalPlayFromZeroDte({
    ticker: "nvda", status: "OPEN", score: 80, entry_premium: 2.0, last_mark: 2.6, live_pnl_pct: 30,
    setup: { direction: "long", dte: 0 },
    why_now: { reason: "accumulation", label: "multi-day accumulation (3d build)" },
    first_flagged_at: "2026-07-25T10:42:00-04:00",
  });
  assert.equal(p.whyNow?.reason, "accumulation");
  assert.match(p.whyNow!.label, /3d build/);
  assert.equal(p.firstFlaggedAt, "2026-07-25T10:42:00-04:00");
});

test("0DTE adapter: setup.first_seen maps to detectedAt for WATCH published clock", () => {
  const p = terminalPlayFromZeroDte({
    ticker: "amd",
    status: "WATCH",
    score: 72,
    setup: { direction: "long", dte: 0, first_seen: "2026-08-03T10:47:00-04:00" },
  });
  assert.equal(p.detectedAt, "2026-08-03T10:47:00-04:00");
});

test("0DTE adapter: WATCH stamps trackPct from flow fill anchor, not pnlPct", () => {
  const p = terminalPlayFromZeroDte({
    ticker: "nvda",
    status: "WATCH",
    score: 70,
    last_mark: 5.0,
    setup: {
      direction: "long",
      dte: 0,
      plan: { flow_avg_fill: 4.0, entry_max: 4.5, mark: 5.0 },
    },
  });
  assert.equal(p.pnlPct, null);
  assert.equal(p.trackReferencePremium, 4.0);
  assert.equal(p.trackPct, 25);
});

test("0DTE adapter: SKIP (gate-blocked WATCH tab) stamps trackPct same as WATCH", () => {
  const p = terminalPlayFromZeroDte({
    ticker: "spxw",
    status: "SKIP",
    score: 55,
    last_mark: 19.15,
    setup: {
      direction: "long",
      dte: 0,
      plan: { flow_avg_fill: 18.0, entry_max: 19.0, mark: 19.15 },
    },
  });
  assert.equal(p.pnlPct, null);
  assert.equal(p.trackReferencePremium, 18.0);
  assert.equal(p.trackPct, 6.39); // (19.15-18)/18*100 rounded 2dp
});

test("horizon adapter: pre-entry COMMIT maps to WATCH; live OPEN maps to OPEN", () => {
  const watch = terminalPlayFromHorizon({
    ticker: "aapl",
    direction: "LONG",
    horizon: "SWING",
    score: 82,
    status: "COMMIT",
    contract: { strike: 200, right: "C", expiry: "2026-09-19", dte: 14, mid: 3.2 },
    flagUnderlyingPx: 195,
    liveSpot: 200,
  });
  assert.equal(watch.status, "WATCH");
  assert.equal(watch.trackPct, 2.56); // (200-195)/195*100 rounded

  const open = terminalPlayFromHorizon({
    ticker: "aapl",
    direction: "LONG",
    horizon: "SWING",
    score: 82,
    status: "COMMIT",
    liveStatus: "OPEN",
    contract: { strike: 200, right: "C", expiry: "2026-09-19", dte: 14, mid: 3.5 },
  });
  assert.equal(open.status, "OPEN");
  assert.equal(open.trackPct, null);
});

test("horizon adapter: live OPEN row wires entry/mark/pnl from live book fields", () => {
  const open = terminalPlayFromHorizon({
    ticker: "nvda",
    direction: "LONG",
    horizon: "SWING",
    score: 82,
    status: "COMMIT",
    liveStatus: "OPEN",
    contract: { strike: 180, right: "C", expiry: "2026-08-14", dte: 14, mid: 5.5 },
    entryPremium: 5.0,
    livePnlPct: 10,
    peakPremium: 5.5,
    troughPremium: 4.8,
  });
  assert.equal(open.status, "OPEN");
  assert.equal(open.entry, 5.0);
  assert.equal(open.mark, 5.5);
  assert.equal(open.pnlPct, 10);
  assert.equal(open.peak, 10);
});

test("legacy adapter: UNVERIFIED morning status → WATCH + unknown thesis", () => {
  const p = terminalPlayFromEdition({
    ticker: "NVDA",
    direction: "long",
    rank: 1,
    score: 85,
    morning_status: "UNVERIFIED",
    morning_reason: "confirm cron has not run",
  });
  assert.equal(p.status, "WATCH");
  assert.equal(p.thesisBreak?.level, "unknown");
  assert.match(p.regime ?? "", /unverified/i);
});

test("0DTE adapter (Wave 3): absent why_now → whyNow null (ribbon omitted, no fabrication)", () => {
  const p = terminalPlayFromZeroDte({
    ticker: "coin", status: "HOLD", score: 60, entry_premium: 5.0, last_mark: 5.0, live_pnl_pct: 0,
    setup: { direction: "long", dte: 0 },
  });
  assert.equal(p.whyNow, null);
  assert.equal(p.firstFlaggedAt, null);
});

test("0DTE adapter (Wave 3): scorecard with Wilson CI passes through unchanged", () => {
  const p = terminalPlayFromZeroDte({
    ticker: "nvda", status: "OPEN", score: 80, entry_premium: 2.0, last_mark: 2.6, live_pnl_pct: 30,
    setup: { direction: "long", dte: 0 },
    scorecard: { winRate: 63, avg: 12, n: 214, ciLow: 55, ciHigh: 70 },
  });
  assert.equal(p.scorecard?.ciLow, 55);
  assert.equal(p.scorecard?.ciHigh, 70);
  assert.equal(p.scorecard?.n, 214);
});

// ── parseLevelNum ──────────────────────────────────────────────────────────────

test("parseLevelNum: parses dollar-level strings", () => {
  assert.equal(parseLevelNum("$205"), 205);
  assert.equal(parseLevelNum("$205.50"), 205.5);
  assert.equal(parseLevelNum("205"), 205);
  assert.equal(parseLevelNum(null), null);
  assert.equal(parseLevelNum(undefined), null);
  assert.equal(parseLevelNum(""), null);
  assert.equal(parseLevelNum("no numbers"), null);
  assert.equal(parseLevelNum("$0"), null);
});

// ── overlayLegacyQuotes ────────────────────────────────────────────────────────

test("overlayLegacyQuotes: computes LONG progress toward target", () => {
  const play = terminalPlayFromEdition({
    ticker: "NVDA", direction: "long", rank: 1, score: 85,
    entry_range: "$180 – $185", target: "$200", stop: "$170",
  });
  const quotes = new Map([["NVDA", { price: 190, changePct: 1.2, asof: "2026-07-28T14:00:00Z" }]]);
  const originals = [{ ticker: "NVDA", target: "$200", stop: "$170", entry_range: "$180 – $185" }];
  const [result] = overlayLegacyQuotes([play], quotes, originals);
  // progress = (190 - 170) / (200 - 170) = 20/30 ≈ 0.667
  assert.ok(result.progress != null);
  assert.ok(Math.abs(result.progress! - 0.667) < 0.01);
  assert.ok(result.recNote?.includes("NVDA $190.00"));
  assert.equal(result.markAsOf, "2026-07-28T14:00:00Z");
});

test("overlayLegacyQuotes: computes SHORT progress toward target", () => {
  const play = terminalPlayFromEdition({
    ticker: "TSLA", direction: "short", rank: 1, score: 80,
    entry_range: "$250 – $255", target: "$230", stop: "$265",
  });
  const quotes = new Map([["TSLA", { price: 245, changePct: -1.5, asof: "2026-07-28T14:00:00Z" }]]);
  const originals = [{ ticker: "TSLA", target: "$230", stop: "$265", entry_range: "$250 – $255" }];
  const [result] = overlayLegacyQuotes([play], quotes, originals);
  // progress = (265 - 245) / (265 - 230) = 20/35 ≈ 0.571
  assert.ok(result.progress != null);
  assert.ok(Math.abs(result.progress! - 0.571) < 0.01);
});

test("overlayLegacyQuotes: no-op when quotes are empty", () => {
  const play = terminalPlayFromEdition({
    ticker: "AAPL", direction: "long", rank: 1, score: 75,
    entry_range: "$190", target: "$210", stop: "$180",
  });
  const result = overlayLegacyQuotes([play], new Map(), [{ ticker: "AAPL", target: "$210", stop: "$180", entry_range: "$190" }]);
  assert.equal(result[0].progress, null);
});

test("overlayLegacyQuotes: clamps progress to [0, 1]", () => {
  const play = terminalPlayFromEdition({
    ticker: "AMD", direction: "long", rank: 1, score: 90,
    entry_range: "$150", target: "$170", stop: "$140",
  });
  // Price above target → progress clamped to 1
  const quotes = new Map([["AMD", { price: 180, changePct: 5.0, asof: "2026-07-28T14:00:00Z" }]]);
  const originals = [{ ticker: "AMD", target: "$170", stop: "$140", entry_range: "$150" }];
  const [result] = overlayLegacyQuotes([play], quotes, originals);
  assert.equal(result.progress, 1);
});

test("Legacy adapter: surfaces conviction as tierLabel", () => {
  const play = terminalPlayFromEdition({
    ticker: "NVDA", direction: "long", rank: 1, score: 85,
    conviction: "A+",
  });
  assert.equal(play.tierLabel, "A+");
});

test("Legacy adapter: surfaces iv_rank and rr_ratio as metadata, not scored factors", () => {
  const play = terminalPlayFromEdition({
    ticker: "TSLA", direction: "long", rank: 1, score: 75,
    iv_rank: 72, rr_ratio: 3.2,
  });
  assert.equal(play.ivRank, 72);
  assert.equal(play.rrRatio, 3.2);
  assert.ok(!play.factors.some((f) => f.label === "IV Rank"));
  assert.ok(!play.factors.some((f) => f.label === "R:R Ratio"));
});

test("Legacy adapter: surfaces the PINNED target-ATR multiple, and never fabricates one", () => {
  // Legacy grades on ONE session, so this multiple is the target's reachability. It must
  // reach the terminal payload unchanged (it is the gate's own measured value) and stay
  // null when the pin is absent or unusable — a fabricated multiple would read as a
  // measured probability on the play card.
  const pinned = terminalPlayFromEdition({
    ticker: "NVDA", direction: "long", rank: 1, score: 75, target_atr_multiple: 1.1,
  });
  assert.equal(pinned.targetAtrMultiple, 1.1);

  const absent = terminalPlayFromEdition({ ticker: "NVDA", direction: "long", rank: 1, score: 75 });
  assert.equal(absent.targetAtrMultiple, null);

  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, null]) {
    const junk = terminalPlayFromEdition({
      ticker: "NVDA", direction: "long", rank: 1, score: 75, target_atr_multiple: bad,
    });
    assert.equal(junk.targetAtrMultiple, null, `target_atr_multiple=${String(bad)}`);
  }
});

test("Legacy adapter: key_signal enriches recNote", () => {
  const play = terminalPlayFromEdition({
    ticker: "META", direction: "long", rank: 1, score: 80,
    thesis: "Bullish breakout above resistance",
    key_signal: "3-day flow accumulation",
  });
  assert.ok(play.recNote?.includes("Key signal: 3-day flow accumulation"));
  assert.ok(play.recNote?.includes("Bullish breakout above resistance"));
});

test("Legacy adapter: risk_note surfaces as thesisBreak warn", () => {
  const play = terminalPlayFromEdition({
    ticker: "AAPL", direction: "long", rank: 1, score: 70,
    risk_note: "Earnings in 2 days — elevated IV",
  });
  assert.equal(play.thesisBreak?.level, "warn");
  assert.equal(play.thesisBreak?.note, "Earnings in 2 days — elevated IV");
});

test("Legacy adapter: morning CONFIRMED overrides risk_note thesisBreak", () => {
  const play = terminalPlayFromEdition({
    ticker: "AAPL", direction: "long", rank: 1, score: 70,
    risk_note: "Earnings in 2 days",
    morning_status: "CONFIRMED",
  });
  assert.equal(play.thesisBreak?.level, "intact");
});

test("Legacy adapter: missing conviction → tierLabel null", () => {
  const play = terminalPlayFromEdition({
    ticker: "SPY", direction: "long", rank: 1, score: 60,
  });
  assert.equal(play.tierLabel, null);
});

test("Legacy adapter: flow_streak_days surfaces as FLOW origin, not a factor", () => {
  const play = terminalPlayFromEdition({
    ticker: "NVDA", direction: "long", rank: 1, score: 55,
    flow_streak_days: 4,
  });
  assert.ok(play.discoveryOrigin?.includes("FLOW"));
  assert.ok(!play.factors.some((f) => f.label === "Flow Streak"));
});

test("Legacy adapter: flow_streak_days zero or null → no factor", () => {
  const p1 = terminalPlayFromEdition({ ticker: "A", direction: "long", rank: 1, score: 50, flow_streak_days: 0 });
  assert.ok(!p1.factors.some((f) => f.label === "Flow Streak"));
  const p2 = terminalPlayFromEdition({ ticker: "A", direction: "long", rank: 1, score: 50, flow_streak_days: null });
  assert.ok(!p2.factors.some((f) => f.label === "Flow Streak"));
});

test("Legacy adapter: entry geometry fields surface on TerminalPlay", () => {
  const play = terminalPlayFromEdition({
    ticker: "AAPL", direction: "long", rank: 1, score: 48,
    entry_range: "$192.50 – $195.00", target: "$210", stop: "$185",
    thesis: "Earnings breakout thesis", key_signal: "Call sweep at $195 strike",
  });
  assert.equal(play.entryRange, "$192.50 – $195.00");
  assert.equal(play.targetLevel, "$210");
  assert.equal(play.stopLevel, "$185");
  assert.equal(play.thesis, "Earnings breakout thesis");
  assert.equal(play.keySignal, "Call sweep at $195 strike");
});

test("Legacy adapter: missing geometry fields → null", () => {
  const play = terminalPlayFromEdition({
    ticker: "SPY", direction: "long", rank: 1, score: 50,
  });
  assert.equal(play.entryRange, null);
  assert.equal(play.targetLevel, null);
  assert.equal(play.stopLevel, null);
  assert.equal(play.thesis, null);
  assert.equal(play.keySignal, null);
});

test("overlayLegacyQuotes: populates stockPrice and stockChangePct", () => {
  const play = terminalPlayFromEdition({
    ticker: "NVDA", direction: "long", rank: 1, score: 85,
    entry_range: "$180 – $185", target: "$200", stop: "$170",
  });
  const quotes = new Map([["NVDA", { price: 192.50, changePct: 2.3, asof: "2026-07-28T15:00:00Z" }]]);
  const originals = [{ ticker: "NVDA", target: "$200", stop: "$170", entry_range: "$180 – $185" }];
  const [result] = overlayLegacyQuotes([play], quotes, originals);
  assert.equal(result.stockPrice, 192.50);
  assert.equal(result.stockChangePct, 2.3);
});

// REWRITTEN 2026-08-07. These asserted that the STOCK's move lands in `pnlPct` — the field the deck
// renders under a "PNL" header for an OPTION position. The old names said "stock-level pnlPct" out
// loud, so the mismatch was known and encoded anyway. Live: MU $880C showed -2% (the stock's move
// off the band midpoint) on a position Polygon priced at -52.3%. The stock move is still computed
// and still asserted — it now lands on `stockMovePct`, where it means what it says.
test("overlayLegacyQuotes: stock move lands on stockMovePct, NOT pnlPct (LONG)", () => {
  const play = terminalPlayFromEdition({
    ticker: "NVDA", direction: "long", rank: 1, score: 85,
    entry_range: "$180 – $185", target: "$200", stop: "$170",
  });
  const quotes = new Map([["NVDA", { price: 192.50, changePct: 2.3, asof: "2026-07-28T15:00:00Z" }]]);
  const originals = [{ ticker: "NVDA", target: "$200", stop: "$170", entry_range: "$180 – $185" }];
  const [result] = overlayLegacyQuotes([play], quotes, originals);
  // entry mid = (180+185)/2 = 182.5, stock = 192.50, stock move = (192.50-182.5)/182.5 = +5.48%
  assert.ok(result.stockMovePct != null, "the stock move should still be computed");
  assert.ok(
    result.stockMovePct! > 5.0 && result.stockMovePct! < 6.0,
    `expected ~5.48%, got ${result.stockMovePct}`,
  );
  // The position P&L fields must stay EMPTY without a live option mark — "—" beats a wrong number.
  assert.equal(result.pnlPct, null, "an underlying move must never be published as the option's P&L");
  assert.equal(result.peak, null);
  assert.equal(result.trough, null);
});

test("overlayLegacyQuotes: stock move lands on stockMovePct, NOT pnlPct (SHORT)", () => {
  const play = terminalPlayFromEdition({
    ticker: "TSLA", direction: "short", rank: 1, score: 80,
    entry_range: "$250 – $255", target: "$230", stop: "$265",
  });
  const quotes = new Map([["TSLA", { price: 240, changePct: -3, asof: "2026-07-28T15:00:00Z" }]]);
  const originals = [{ ticker: "TSLA", target: "$230", stop: "$265", entry_range: "$250 – $255" }];
  const [result] = overlayLegacyQuotes([play], quotes, originals);
  // entry mid = (250+255)/2 = 252.5, stock = 240, short stock move = (252.5-240)/252.5 = +4.95%
  assert.ok(result.stockMovePct != null, "the stock move should still be computed");
  assert.ok(
    result.stockMovePct! > 4.5 && result.stockMovePct! < 5.5,
    `expected ~4.95%, got ${result.stockMovePct}`,
  );
  assert.equal(result.pnlPct, null, "an underlying move must never be published as the option's P&L");
});

test("Legacy adapter: confirming_signals → confluence badge, not a factor", () => {
  const play = terminalPlayFromEdition({ ticker: "AAA", direction: "long", rank: 1, score: 68, confirming_signals: 5 });
  assert.equal(play.confluence, 5);
  assert.ok(!play.factors.some((f) => f.label === "Confirming"));
});

test("Legacy adapter: stock entry mid preferred over option premium for entry field", () => {
  const play = terminalPlayFromEdition({
    ticker: "NVDA", direction: "long", rank: 1, score: 80,
    entry_range: "$98.00-$100.00",
    entry_premium: 6.2,
  });
  assert.equal(play.entry, 99);
  assert.equal(play.entryCostPerContract, 6.2);
});

test("Legacy adapter: earnings_risk → EARNINGS RISK gate", () => {
  const play = terminalPlayFromEdition({ ticker: "AAA", direction: "long", rank: 1, score: 68, earnings_risk: true });
  const g = play.gates.find((g) => g.label === "EARNINGS RISK");
  assert.ok(g, "expected an EARNINGS RISK gate");
  assert.equal(g!.ok, false);
});

test("Legacy adapter: optionsPlay and rrRatio surface on TerminalPlay", () => {
  const play = terminalPlayFromEdition({
    ticker: "MSFT", direction: "long", rank: 1, score: 72,
    options_play: "Buy MSFT 450C 8/8 @ $6.20", rr_ratio: 2.4,
  });
  assert.equal(play.optionsPlay, "Buy MSFT 450C 8/8 @ $6.20");
  assert.equal(play.rrRatio, 2.4);
});

test("Legacy adapter: premium_cap_ok false → PREMIUM HIGH gate", () => {
  const play = terminalPlayFromEdition({
    ticker: "TSLA", direction: "long", rank: 1, score: 60,
    premium_cap_ok: false, entry_premium: 22.50,
  });
  const g = play.gates.find((g) => g.label === "PREMIUM HIGH");
  assert.ok(g, "expected a PREMIUM HIGH gate");
  assert.equal(g!.ok, false);
  assert.equal(play.premiumCapOk, false);
});

test("Legacy adapter: premium_cap_ok true → no PREMIUM HIGH gate", () => {
  const play = terminalPlayFromEdition({
    ticker: "AAPL", direction: "long", rank: 1, score: 60,
    premium_cap_ok: true, entry_premium: 4.50,
  });
  assert.ok(!play.gates.some((g) => g.label === "PREMIUM HIGH"));
  assert.equal(play.premiumCapOk, true);
});

test("Legacy adapter: entry_premium maps to entryCostPerContract when no entry_cost_per_contract", () => {
  const play = terminalPlayFromEdition({
    ticker: "NVDA", direction: "long", rank: 1, score: 80,
    entry_premium: 4.5,
  });
  assert.equal(play.entryCostPerContract, 4.5);
});

test("Legacy adapter: missing optionsPlay/rrRatio → null", () => {
  const play = terminalPlayFromEdition({ ticker: "SPY", direction: "long", rank: 1, score: 50 });
  assert.equal(play.optionsPlay, null);
  assert.equal(play.rrRatio, null);
});

test("overlayLegacyQuotes: stockPrice stays undefined when no quote", () => {
  const play = terminalPlayFromEdition({
    ticker: "AAPL", direction: "long", rank: 1, score: 75,
    entry_range: "$190", target: "$210", stop: "$180",
  });
  const result = overlayLegacyQuotes([play], new Map(), [{ ticker: "AAPL", target: "$210", stop: "$180", entry_range: "$190" }]);
  assert.equal(result[0].stockPrice, undefined);
  assert.equal(result[0].stockChangePct, undefined);
});

test("overlayLegacyQuotes: LONG at stop → recommendation SELL", () => {
  const play = terminalPlayFromEdition({
    ticker: "NVDA", direction: "long", rank: 1, score: 85,
    entry_range: "$180", target: "$200", stop: "$170",
  });
  const quotes = new Map([["NVDA", { price: 169, changePct: -5, asof: "2026-07-28T14:00:00Z" }]]);
  const originals = [{ ticker: "NVDA", target: "$200", stop: "$170", entry_range: "$180" }];
  const [result] = overlayLegacyQuotes([play], quotes, originals);
  assert.equal(result.recommendation, "SELL");
  assert.ok(result.recNote!.includes("stop level"));
});

test("overlayLegacyQuotes: LONG at target → recommendation TRIM", () => {
  const play = terminalPlayFromEdition({
    ticker: "NVDA", direction: "long", rank: 1, score: 85,
    entry_range: "$180", target: "$200", stop: "$170",
  });
  const quotes = new Map([["NVDA", { price: 202, changePct: 3, asof: "2026-07-28T14:00:00Z" }]]);
  const originals = [{ ticker: "NVDA", target: "$200", stop: "$170", entry_range: "$180" }];
  const [result] = overlayLegacyQuotes([play], quotes, originals);
  assert.equal(result.recommendation, "TRIM");
  assert.ok(result.recNote!.includes("target"));
});

test("overlayLegacyQuotes: SHORT at stop → recommendation SELL", () => {
  const play = terminalPlayFromEdition({
    ticker: "TSLA", direction: "short", rank: 1, score: 80,
    entry_range: "$250", target: "$230", stop: "$265",
  });
  const quotes = new Map([["TSLA", { price: 266, changePct: 2, asof: "2026-07-28T14:00:00Z" }]]);
  const originals = [{ ticker: "TSLA", target: "$230", stop: "$265", entry_range: "$250" }];
  const [result] = overlayLegacyQuotes([play], quotes, originals);
  assert.equal(result.recommendation, "SELL");
});

test("overlayLegacyQuotes: SHORT at target → recommendation TRIM", () => {
  const play = terminalPlayFromEdition({
    ticker: "TSLA", direction: "short", rank: 1, score: 80,
    entry_range: "$250", target: "$230", stop: "$265",
  });
  const quotes = new Map([["TSLA", { price: 228, changePct: -4, asof: "2026-07-28T14:00:00Z" }]]);
  const originals = [{ ticker: "TSLA", target: "$230", stop: "$265", entry_range: "$250" }];
  const [result] = overlayLegacyQuotes([play], quotes, originals);
  assert.equal(result.recommendation, "TRIM");
});

test("overlayLegacyQuotes: between stop and target → keeps original recommendation", () => {
  const play = terminalPlayFromEdition({
    ticker: "NVDA", direction: "long", rank: 1, score: 85,
    entry_range: "$180", target: "$200", stop: "$170",
  });
  const quotes = new Map([["NVDA", { price: 185, changePct: 1, asof: "2026-07-28T14:00:00Z" }]]);
  const originals = [{ ticker: "NVDA", target: "$200", stop: "$170", entry_range: "$180" }];
  const [result] = overlayLegacyQuotes([play], quotes, originals);
  assert.equal(result.recommendation, "HOLD");
});


// ─── SEV-3 (FINDINGS 2026-08-06): the SWING/LEAPS greek strip was hardcoded to null ─────────────

test("horizon adapter: greeks are built from the contract, not hardcoded null", () => {
  const play = terminalPlayFromHorizon({
    ticker: "nvda", direction: "LONG", horizon: "SWING", score: 77,
    contract: {
      strike: 180, right: "C", expiry: "2026-08-14", dte: 8, mid: 5.5,
      delta: 0.58, gamma: 0.021, theta: -0.13, vega: 0.19, iv: 0.42,
    },
  });
  assert.deepEqual(play.greeks, { delta: 0.58, gamma: 0.021, theta: -0.13, vega: 0.19, iv: 0.42 });
});

test("horizon adapter: a partial greek set keeps the present values and nulls the rest", () => {
  // The pre-entry lane can only supply delta + iv (explodeChainRows' source rows have no
  // gamma/theta/vega columns). Those two must still render rather than being suppressed.
  const play = terminalPlayFromHorizon({
    ticker: "nvda", direction: "LONG", horizon: "SWING", score: 77,
    contract: { strike: 180, right: "C", expiry: "2026-08-14", dte: 8, mid: 5.5, delta: 0.58, iv: 0.42 },
  });
  assert.deepEqual(play.greeks, { delta: 0.58, gamma: null, theta: null, vega: null, iv: 0.42 });
});

test("horizon adapter: NO greek on the contract → a null strip (absent, not five em-dashes)", () => {
  const play = terminalPlayFromHorizon({
    ticker: "nvda", direction: "LONG", horizon: "SWING", score: 77,
    contract: { strike: 180, right: "C", expiry: "2026-08-14", dte: 8, mid: 5.5 },
  });
  assert.equal(play.greeks, null);
});

test("horizon adapter: a non-finite greek is dropped to null, never passed through", () => {
  const play = terminalPlayFromHorizon({
    ticker: "nvda", direction: "LONG", horizon: "SWING", score: 77,
    contract: {
      strike: 180, right: "C", expiry: "2026-08-14", dte: 8, mid: 5.5,
      delta: 0.58, gamma: Number.NaN, theta: Number.POSITIVE_INFINITY,
    },
  });
  assert.equal(play.greeks!.delta, 0.58);
  assert.equal(play.greeks!.gamma, null);
  assert.equal(play.greeks!.theta, null);
});


// ── TIME COLUMN: read first_seen from BOTH source shapes (2026-08-07) ────────────────────────
// The board serves a LEDGER row (live setup nested under `setup`) and a BARE board setup (fields at
// the top level) through one adapter. Only the nested shape was read, so bare rows lost their
// detection time and the deck's TIME column rendered "—". Measured live: 10/10 board setups carried
// a top-level `first_seen` and 0/10 had a nested `setup`; the deck showed a clock on 1 row of 56.

test("firstSeenIso: reads the NESTED setup timestamp (ledger row shape)", () => {
  assert.equal(firstSeenIso({}, { first_seen: "2026-08-07T13:37:00Z" }), "2026-08-07T13:37:00Z");
});

test("firstSeenIso: falls back to the TOP-LEVEL timestamp (bare board setup) — the live regression", () => {
  assert.equal(firstSeenIso({ first_seen: "2026-08-07T13:37:00Z" }, null), "2026-08-07T13:37:00Z");
});

test("firstSeenIso: prefers nested over top-level when a row carries both", () => {
  assert.equal(
    firstSeenIso({ first_seen: "2026-08-07T10:00:00Z" }, { first_seen: "2026-08-07T13:37:00Z" }),
    "2026-08-07T13:37:00Z"
  );
});

test("firstSeenIso: returns null — never a fabricated time — when neither shape has one", () => {
  // The deck SORTS and AGES rows off this value, so inventing one would silently reorder the board.
  assert.equal(firstSeenIso(null, null), null);
  assert.equal(firstSeenIso({}, {}), null);
  assert.equal(firstSeenIso({ first_seen: "" }, { first_seen: "" }), null);
});
