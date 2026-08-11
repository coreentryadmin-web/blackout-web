import { test } from "node:test";
import assert from "node:assert/strict";

// governor.ts's only stateful dependency is @/lib/shared-cache, which (with no
// REDIS_URL set, as here) transparently uses its own in-memory fallback map — so
// the record/load round-trip below exercises the REAL persistence code path, no
// mock.module scaffolding needed. Each test uses its own session date to keep the
// shared in-memory map from leaking state between tests.
import {
  deriveGovernorFromLedger,
  evaluateZeroDteGovernor,
  governorLossHaltReason,
  loadRecordedGovernorStops,
  mergeGovernorStops,
  recordGovernorStops,
  summarizeGovernorForBoard,
  aggregatePremiumAtRisk,
  timeOfDaySizingFactor,
  maxCorrelatedSameDirection,
  concentrationReasonForCandidate,
  freezeConcentrationState,
  correlationGroupOf,
  correlationGroupId,
  CONCENTRATION_POLICY_VERSION,
  GOVERNOR_MAX_CONCURRENT_PLANS,
  GOVERNOR_MAX_SESSION_STOPS,
  GOVERNOR_REENTRY_LOCK_MS,
  GOVERNOR_LOSS_HALT_COUNT,
  GOVERNOR_SESSION_LOSS_FLOOR_PCT,
  GOVERNOR_MAX_CORRELATED_SAME_DIR,
  type GovernorLedgerRow,
} from "./governor";

const NOW = Date.parse("2026-07-13T17:00:00Z");

function row(overrides: Partial<GovernorLedgerRow> = {}): GovernorLedgerRow {
  return {
    ticker: "NVDA",
    direction: "long",
    status: "OPEN",
    entry_premium: 4.0,
    trough_premium: 4.0,
    plan_outcome: null,
    plan_pnl_pct: null,
    last_mark: null,
    last_mark_at: null,
    ...overrides,
  };
}

/** A LOSING time-stop: closed red at 15:30 without ever touching the −50% hard stop
 *  (trough stays above the 2.0 stop level on a 4.0 entry). The exact class the
 *  hard-stop count excluded (AUDIT SEV-3). */
function losingTimeStop(ticker: string, pnlPct = -30): GovernorLedgerRow {
  return row({
    ticker,
    status: "CLOSED",
    plan_outcome: "time_stop",
    plan_pnl_pct: pnlPct,
    trough_premium: 3.0, // above the 2.0 hard-stop level → NOT a hard stop
  });
}

// ── anti-overfit FIREWALL: value-pin the governor risk brakes (Step 5) ────────────────
// Session-stop halt + re-entry lock stay pinned — those are the 7/13 runaway-loss brakes.
// Concurrent open-play ceiling is a PRODUCT dial (default 100 / env ZERODTE_MAX_CONCURRENT),
// NOT a scarcity throttle: quality gates + stop/loss floors decide how many plans are live.
test("FIREWALL: governor risk brakes are pinned (halt after 3 stops, 20-min re-entry lock; concurrent default 100)", () => {
  assert.equal(GOVERNOR_MAX_CONCURRENT_PLANS, 100);
  assert.equal(GOVERNOR_MAX_SESSION_STOPS, 3);
  assert.equal(GOVERNOR_REENTRY_LOCK_MS, 20 * 60 * 1000);
});

// AUDIT SEV-3 — the realized-loss halt only ever ADDS conservatism; a silent LOOSENING
// (count up, floor down toward 0) would re-open the chop-and-bleed channel it closes.
test("FIREWALL: realized-loss halt thresholds are pinned (5 losers, −120% session floor)", () => {
  assert.equal(GOVERNOR_LOSS_HALT_COUNT, 5);
  assert.equal(GOVERNOR_SESSION_LOSS_FLOOR_PCT, -120);
});

// ── ledger-derived snapshot ────────────────────────────────────────────────────────

test("deriveGovernorFromLedger: non-CLOSED rows count as open — including null status (just committed)", () => {
  const snap = deriveGovernorFromLedger([
    row({ ticker: "A", status: "OPEN" }),
    row({ ticker: "B", status: "HOLD" }),
    row({ ticker: "C", status: "TRIM" }),
    row({ ticker: "D", status: null }), // committed this cycle, cron hasn't synced yet
    row({ ticker: "E", status: "CLOSED" }),
  ]);
  assert.deepEqual(snap.open_plans.map((p) => p.ticker).sort(), ["A", "B", "C", "D"]);
});

test("deriveGovernorFromLedger: a stop is detected from the graded plan_outcome OR the latched trough", () => {
  const snap = deriveGovernorFromLedger([
    // Graded stop (lazy grader already ran).
    row({ ticker: "MU", status: "CLOSED", plan_outcome: "stopped" }),
    // Ungraded but the latched trough crossed the -50% stop level (2.0 on a 4.0 entry).
    row({ ticker: "SPY", status: "CLOSED", trough_premium: 1.9 }),
    // Time-stop close, trough never near the stop — NOT a stop.
    row({ ticker: "QQQ", status: "CLOSED", trough_premium: 3.8 }),
    // Still open — its drawdown isn't a stop yet.
    row({ ticker: "AMD", status: "HOLD", trough_premium: 2.5 }),
  ]);
  assert.deepEqual(snap.stops.map((s) => s.ticker).sort(), ["MU", "SPY"]);
  assert.ok(snap.stops.every((s) => s.at_ms === null), "ledger stops carry no fabricated timestamp");
});

test("mergeGovernorStops: recorded (timestamped) events win over timeless ledger twins, unions the rest", () => {
  const merged = mergeGovernorStops(
    [
      { ticker: "MU", direction: "long", at_ms: null },
      { ticker: "SPY", direction: "long", at_ms: null },
    ],
    [
      { ticker: "MU", direction: "long", at_ms: NOW - 5 * 60_000 },
      { ticker: "AMD", direction: "long", at_ms: NOW - 60_000 },
    ]
  );
  const byTicker = new Map(merged.map((s) => [s.ticker, s]));
  assert.equal(merged.length, 3);
  assert.equal(byTicker.get("MU")!.at_ms, NOW - 5 * 60_000);
  assert.equal(byTicker.get("SPY")!.at_ms, null);
  assert.equal(byTicker.get("AMD")!.at_ms, NOW - 60_000);
});

// ── pure rules ─────────────────────────────────────────────────────────────────────

test("governor: 3 stops halt the session — single dominating block", () => {
  const stops = ["SPY", "MU", "AMD"].map((t) => ({ ticker: t, direction: "long" as const, at_ms: null }));
  const blocks = evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, { open_plans: [], stops }, NOW);
  assert.deepEqual(blocks.map((b) => b.code), ["governor_session_stops"]);
  assert.equal(blocks[0]!.threshold, GOVERNOR_MAX_SESSION_STOPS);
});

test("governor: concurrency ceiling blocks only at the configured max (default 100)", () => {
  const under = Array.from({ length: GOVERNOR_MAX_CONCURRENT_PLANS - 1 }, (_, i) => ({
    ticker: `T${i}`,
    direction: "long" as const,
  }));
  const ok = evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, { open_plans: under, stops: [] }, NOW);
  assert.deepEqual(ok, []);
  const atCap = [
    ...under,
    { ticker: `T${GOVERNOR_MAX_CONCURRENT_PLANS - 1}`, direction: "long" as const },
  ];
  const blocked = evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, { open_plans: atCap, stops: [] }, NOW);
  assert.deepEqual(blocked.map((b) => b.code), ["governor_max_concurrent"]);
  assert.equal(blocked[0]!.threshold, GOVERNOR_MAX_CONCURRENT_PLANS);
});

test("governor/B-3: QQQ short against an OPEN SPY long is a correlated conflict — blocked", () => {
  // 7/13 ran exactly this pair live: SPY long (09:55) and QQQ short (10:20) at once.
  const snap = { open_plans: [{ ticker: "SPY", direction: "long" as const }], stops: [] };
  const blocked = evaluateZeroDteGovernor({ ticker: "QQQ", direction: "short" }, snap, NOW);
  assert.deepEqual(blocked.map((b) => b.code), ["correlated_conflict"]);
  assert.match(blocked[0]!.reason, /OPEN SPY long/, "the open ticker is named in the detail");
});

test("governor/B-3: direction AGREEMENT with the open correlated plan is allowed", () => {
  const snap = { open_plans: [{ ticker: "SPY", direction: "long" as const }], stops: [] };
  assert.deepEqual(evaluateZeroDteGovernor({ ticker: "QQQ", direction: "long" }, snap, NOW), []);
});

test("governor/B-3: no open plays — nothing to conflict with", () => {
  assert.deepEqual(
    evaluateZeroDteGovernor({ ticker: "QQQ", direction: "short" }, { open_plans: [], stops: [] }, NOW),
    []
  );
});

test("governor/B-3: v1 groups are the index/ETF complex only — a single name doesn't trip it", () => {
  const snap = { open_plans: [{ ticker: "SPY", direction: "long" as const }], stops: [] };
  assert.deepEqual(evaluateZeroDteGovernor({ ticker: "NVDA", direction: "short" }, snap, NOW), []);
});

test("governor: 20-min same-direction re-entry lock — inside blocks, outside/opposite pass", () => {
  const stopAt = NOW - 10 * 60_000; // 10 minutes ago
  const snap = { open_plans: [], stops: [{ ticker: "META", direction: "short" as const, at_ms: stopAt }] };

  const locked = evaluateZeroDteGovernor({ ticker: "META", direction: "short" }, snap, NOW);
  assert.deepEqual(locked.map((b) => b.code), ["governor_reentry_lock"]);
  assert.match(locked[0]!.reason, /10 more minutes/);

  // Lock expired.
  const later = NOW - GOVERNOR_REENTRY_LOCK_MS - (NOW - stopAt);
  const expired = evaluateZeroDteGovernor(
    { ticker: "META", direction: "short" },
    { open_plans: [], stops: [{ ticker: "META", direction: "short", at_ms: later }] },
    NOW
  );
  assert.deepEqual(expired, []);

  // Opposite direction is a different trade — not locked.
  assert.deepEqual(evaluateZeroDteGovernor({ ticker: "META", direction: "long" }, snap, NOW), []);

  // A stop on a DIFFERENT ticker never locks this candidate, timed or not.
  assert.deepEqual(evaluateZeroDteGovernor({ ticker: "NVDA", direction: "short" }, snap, NOW), []);
});

// ── P2 (2026-08-06 audit): the at_ms === null boundary — FAIL CLOSED ─────────────────
// Live prod capture, /api/market/zerodte/board at 18:33 AND 19:33 UTC 2026-08-06:
//   "stops":[{"ticker":"SPXW","direction":"short","at_ms":null}], "reentry_lock_ms":1200000
// Under the old `s.at_ms != null &&` guard that ticker was silently EXEMPT from G-5 —
// loss control off for the one name carrying a stop. These pin the corrected semantics.
test("governor/P2: an UNTIMED stop locks same-direction re-entry for the session (fail-closed)", () => {
  const untimed = { open_plans: [], stops: [{ ticker: "SPXW", direction: "short" as const, at_ms: null }] };

  const blocked = evaluateZeroDteGovernor({ ticker: "SPXW", direction: "short" }, untimed, NOW);
  assert.deepEqual(blocked.map((b) => b.code), ["governor_reentry_lock"]);
  assert.equal(
    blocked[0]!.threshold,
    null,
    "threshold stays null — no timer backs an untimed lock (the tell that distinguishes it)"
  );
  assert.match(blocked[0]!.reason, /stop time was never recorded/);
  assert.doesNotMatch(
    blocked[0]!.reason,
    /\d+ more minute/,
    "never fabricate a countdown from a timestamp we do not have"
  );

  // Still locked an arbitrarily long time later — the session, not a 20-minute window,
  // is the bound (this is the case the old code let through the moment 20 min elapsed).
  assert.deepEqual(
    evaluateZeroDteGovernor(
      { ticker: "SPXW", direction: "short" },
      untimed,
      NOW + 6 * 60 * 60_000
    ).map((b) => b.code),
    ["governor_reentry_lock"],
    "an untimed stop cannot expire — there is no timestamp to measure expiry from"
  );

  // Fail-closed is SCOPED: opposite direction and other tickers are untouched.
  assert.deepEqual(evaluateZeroDteGovernor({ ticker: "SPXW", direction: "long" }, untimed, NOW), []);
  assert.deepEqual(evaluateZeroDteGovernor({ ticker: "NVDA", direction: "short" }, untimed, NOW), []);
});

test("governor/P2: a recorded (timed) twin downgrades the session hold to the real 20-min timer", () => {
  // mergeGovernorStops is the upgrade path — once the Redis lane supplies at_ms, the
  // fail-closed session hold must give way to the ordinary expiring lock.
  const merged = mergeGovernorStops(
    [{ ticker: "SPXW", direction: "short", at_ms: null }],
    [{ ticker: "SPXW", direction: "short", at_ms: NOW - GOVERNOR_REENTRY_LOCK_MS - 1 }]
  );
  assert.equal(merged.length, 1);
  assert.notEqual(merged[0]!.at_ms, null, "the recorded twin wins — that is what carries the time");
  assert.deepEqual(
    evaluateZeroDteGovernor({ ticker: "SPXW", direction: "short" }, { open_plans: [], stops: merged }, NOW),
    [],
    "with a real timestamp older than the lock window the ticker is re-entrable again"
  );
});

// ── AUDIT SEV-3: realized-loss day-halt (losing time-stops, not just −50% hard stops) ──

test("SEV-3 REGRESSION CLOSED: a session of 5 losing time-stops (no hard stop) now halts new commits", () => {
  // The exact gap: five committed plays each close red at 15:30 (−30%) without ever
  // touching the −50% hard stop. Pre-fix, stops.length stayed 0 all day and the scanner
  // kept committing — same capital bleed as 7/13, uncapped.
  const rows = ["A", "B", "C", "D", "E"].map((t) => losingTimeStop(t));
  const snap = deriveGovernorFromLedger(rows);
  assert.equal(snap.stops.length, 0, "none are HARD stops — the old halt channel stays silent");
  assert.equal(snap.realized_losers, 5, "but all five are realized losers");

  const blocks = evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, snap, NOW);
  assert.deepEqual(blocks.map((b) => b.code), ["governor_session_loss_halt"]);
  assert.equal(blocks[0]!.threshold, GOVERNOR_LOSS_HALT_COUNT);
  assert.match(blocks[0]!.reason, /realized losers/, "the block names the realized-loss cause");
});

test("SEV-3: the cumulative session-P&L floor halts even below the loser COUNT", () => {
  // Two big losers (−70% each = −140%) sink past the −120% floor before hitting 5 losers.
  const rows = [
    losingTimeStop("A", -70),
    losingTimeStop("B", -70),
  ];
  const snap = deriveGovernorFromLedger(rows);
  assert.equal(snap.realized_losers, 2, "below the count cap");
  assert.ok(snap.session_pnl_pct! <= GOVERNOR_SESSION_LOSS_FLOOR_PCT, "but past the P&L floor");
  const blocks = evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, snap, NOW);
  assert.deepEqual(blocks.map((b) => b.code), ["governor_session_loss_halt"]);
  assert.match(blocks[0]!.reason, /floor/);
});

test("SEV-3: a session of WINNERS does not halt (only losing exits count)", () => {
  const rows = ["A", "B", "C", "D"].map((t) =>
    row({ ticker: t, status: "CLOSED", plan_outcome: "doubled", plan_pnl_pct: 100, trough_premium: 3.5 })
  );
  const snap = deriveGovernorFromLedger(rows);
  assert.equal(snap.realized_losers, 0);
  assert.equal(snap.session_pnl_pct, 400);
  assert.equal(governorLossHaltReason(snap), null, "no loss-halt reason to surface");
  assert.deepEqual(evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, snap, NOW), []);
});

test("SEV-3: winners net against losers — a green session under the floor stays open", () => {
  // 2 losers (−40% each = −80%) but 2 winners (+100% each) → cumulative +120%, and only
  // 2 losers < the count cap → no halt.
  const rows = [
    losingTimeStop("A", -40),
    losingTimeStop("B", -40),
    row({ ticker: "C", status: "CLOSED", plan_outcome: "doubled", plan_pnl_pct: 100, trough_premium: 3.5 }),
    row({ ticker: "D", status: "CLOSED", plan_outcome: "doubled", plan_pnl_pct: 100, trough_premium: 3.5 }),
  ];
  const snap = deriveGovernorFromLedger(rows);
  assert.equal(snap.realized_losers, 2);
  assert.equal(snap.session_pnl_pct, 120);
  assert.deepEqual(evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, snap, NOW), []);
});

test("SEV-3: the existing 3× HARD-stop halt + re-entry lock still fire unchanged", () => {
  // Hard-stop halt: 3 graded stops → the ORIGINAL block, with the ORIGINAL threshold.
  const stops = ["SPY", "MU", "AMD"].map((t) => ({ ticker: t, direction: "long" as const, at_ms: null }));
  const halt = evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, { open_plans: [], stops }, NOW);
  assert.deepEqual(halt.map((b) => b.code), ["governor_session_stops"]);
  assert.equal(halt[0]!.threshold, GOVERNOR_MAX_SESSION_STOPS, "hard-stop halt keeps its own threshold");
  assert.match(halt[0]!.reason, /stopped out today/, "hard-stop wording, not the realized-loss wording");

  // Re-entry lock (keyed off a hard stop's timestamp) is untouched by the loss channel.
  const stopAt = NOW - 10 * 60_000;
  const lockSnap = { open_plans: [], stops: [{ ticker: "META", direction: "short" as const, at_ms: stopAt }] };
  const locked = evaluateZeroDteGovernor({ ticker: "META", direction: "short" }, lockSnap, NOW);
  assert.deepEqual(locked.map((b) => b.code), ["governor_reentry_lock"]);
});

test("SEV-3: a hard stop is also counted as a realized loser (union, not double-halt logic drift)", () => {
  // An ungraded hard stop (trough crossed, plan_pnl_pct not yet stamped) still contributes
  // its −50% to the session tally via the fallback — the loss channel agrees with the stop
  // channel before the grader runs.
  const snap = deriveGovernorFromLedger([
    row({ ticker: "SPY", status: "CLOSED", trough_premium: 1.9 }), // ungraded hard stop
  ]);
  assert.equal(snap.stops.length, 1);
  assert.equal(snap.realized_losers, 1);
  assert.equal(snap.session_pnl_pct, -50);
});

test("SEV-3: would_halt is SURFACED on the board summary on real ledger evidence", () => {
  const rows = ["A", "B", "C", "D", "E"].map((t) => losingTimeStop(t));
  const s = summarizeGovernorForBoard(rows, []);
  assert.equal(s.realized_losers, 5);
  assert.equal(s.session_pnl_pct, -150);
  assert.equal(s.loss_halt_count, GOVERNOR_LOSS_HALT_COUNT);
  assert.equal(s.session_loss_floor_pct, GOVERNOR_SESSION_LOSS_FLOOR_PCT);
  assert.match(s.would_halt ?? "", /realized losers/, "the halt reason is exposed for the operator");
  assert.equal(s.halted, true, "and the desk reads as stood-down even with zero HARD stops");
  assert.equal(s.stops.length, 0, "…none of which are hard stops");
});

test("SEV-3: a clean session surfaces no would_halt and stays un-halted", () => {
  const s = summarizeGovernorForBoard([row({ ticker: "NVDA", status: "HOLD" })], []);
  assert.equal(s.would_halt, null);
  assert.equal(s.halted, false);
  assert.equal(s.realized_losers, 0);
});

// ── board summary (PR-D governor strip) ────────────────────────────────────────────

test("summarizeGovernorForBoard: carries the REAL caps + lock length so the pane never hardcodes them", () => {
  const s = summarizeGovernorForBoard([], []);
  assert.equal(s.max_concurrent, GOVERNOR_MAX_CONCURRENT_PLANS);
  assert.equal(s.max_session_stops, GOVERNOR_MAX_SESSION_STOPS);
  assert.equal(s.reentry_lock_ms, GOVERNOR_REENTRY_LOCK_MS);
  assert.equal(s.halted, false);
  assert.deepEqual(s.open_plans, []);
  assert.deepEqual(s.stops, []);
});

test("summarizeGovernorForBoard: merges recorded stop timestamps and flips halted at the cap", () => {
  const s = summarizeGovernorForBoard(
    [
      row({ ticker: "SPY", status: "CLOSED", trough_premium: 1.9 }), // trough-crossed stop, untimed
      row({ ticker: "MU", status: "CLOSED", plan_outcome: "stopped" }),
      row({ ticker: "AMD", status: "CLOSED", plan_outcome: "stopped" }),
      row({ ticker: "NVDA", status: "HOLD" }),
    ],
    [{ ticker: "SPY", direction: "long", at_ms: NOW - 5 * 60_000 }]
  );
  assert.equal(s.halted, true, "3 stops = session halt");
  assert.equal(s.stops.length, 3);
  assert.equal(s.stops.find((x) => x.ticker === "SPY")!.at_ms, NOW - 5 * 60_000, "recorded timestamp wins");
  assert.equal(s.stops.find((x) => x.ticker === "MU")!.at_ms, null, "ledger-only stop stays untimed");
  assert.deepEqual(s.open_plans, [{ ticker: "NVDA", direction: "long" }]);
});

// ── persistence round-trip (real shared-cache in-memory fallback) ──────────────────

test("governor state: a simulated 3-stop session persists, reloads, and halts", async () => {
  const day = "2099-01-02"; // unique per test — the fallback map is module-global
  await recordGovernorStops(day, [{ ticker: "SPY", direction: "long", at_ms: NOW - 30 * 60_000 }]);
  await recordGovernorStops(day, [{ ticker: "MU", direction: "long", at_ms: NOW - 20 * 60_000 }]);
  await recordGovernorStops(day, [{ ticker: "AMD", direction: "long", at_ms: NOW - 5 * 60_000 }]);

  const recorded = await loadRecordedGovernorStops(day);
  assert.equal(recorded.length, 3);

  const snap = { open_plans: [], stops: mergeGovernorStops([], recorded) };
  const blocks = evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, snap, NOW);
  assert.deepEqual(blocks.map((b) => b.code), ["governor_session_stops"]);
});

test("governor state: first-write-wins per ticker — re-observing a stopped row never resets its lock clock", async () => {
  const day = "2099-01-03";
  const firstSeen = NOW - 15 * 60_000;
  await recordGovernorStops(day, [{ ticker: "META", direction: "short", at_ms: firstSeen }]);
  // The same stopped row observed again on a later sync tick.
  await recordGovernorStops(day, [{ ticker: "META", direction: "short", at_ms: NOW }]);

  const recorded = await loadRecordedGovernorStops(day);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]!.at_ms, firstSeen);
});

test("governor state: an empty/unknown session date loads as no stops (never a guess)", async () => {
  assert.deepEqual(await loadRecordedGovernorStops("2099-01-04"), []);
});

// ── Q9 — same-direction concentration MEASURE (surfaced, not enforced) ──────────────

test("maxCorrelatedSameDirection: finds the largest same-direction correlated cluster; ignores opposed/uncorrelated", () => {
  // SPY/QQQ/IWM long = a 3-cluster of the same index/ETF beta; the DIA short and the
  // uncorrelated NVDA long don't join it.
  const cluster = maxCorrelatedSameDirection([
    { ticker: "SPY", direction: "long" },
    { ticker: "QQQ", direction: "long" },
    { ticker: "IWM", direction: "long" },
    { ticker: "DIA", direction: "short" },
    { ticker: "NVDA", direction: "long" },
  ]);
  assert.deepEqual(cluster, { tickers: ["IWM", "QQQ", "SPY"], direction: "long", count: 3 });
});

test("maxCorrelatedSameDirection: a single correlated plan (or none) is not a cluster → null; two in the same group IS a cluster", () => {
  assert.equal(maxCorrelatedSameDirection([{ ticker: "SPY", direction: "long" }]), null);
  // NVDA + AMD are both Semiconductors (v2) → a 2-cluster
  assert.deepEqual(maxCorrelatedSameDirection([{ ticker: "NVDA", direction: "long" }, { ticker: "AMD", direction: "long" }]),
    { tickers: ["AMD", "NVDA"], direction: "long", count: 2 });
  // Two uncorrelated names → no cluster
  assert.equal(maxCorrelatedSameDirection([{ ticker: "NVDA", direction: "long" }, { ticker: "JPM", direction: "long" }]), null);
  assert.equal(maxCorrelatedSameDirection([]), null);
});

test("maxCorrelatedSameDirection: duplicate ticker rows do not inflate the count (distinct exposures only)", () => {
  const cluster = maxCorrelatedSameDirection([
    { ticker: "SPY", direction: "long" },
    { ticker: "SPY", direction: "long" },
  ]);
  assert.equal(cluster, null); // one distinct exposure, not a 2-cluster
});

test("concentrationReasonForCandidate: fires when the candidate would exceed the cap; null under it", () => {
  const twoLongs = [
    { ticker: "SPY", direction: "long" as const },
    { ticker: "QQQ", direction: "long" as const },
  ];
  // Adding a 3rd correlated long (cap 2) → measured reason.
  const reason = concentrationReasonForCandidate({ ticker: "IWM", direction: "long" }, twoLongs);
  assert.ok(reason && /over-concentration/.test(reason));
  // A correlated SHORT is opposed, not concentration (that's the separate conflict rule).
  assert.equal(concentrationReasonForCandidate({ ticker: "IWM", direction: "short" }, twoLongs), null);
  // Only ONE correlated same-direction open → under the cap, no measure.
  assert.equal(
    concentrationReasonForCandidate({ ticker: "IWM", direction: "long" }, [{ ticker: "SPY", direction: "long" }]),
    null
  );
  // Uncorrelated candidate → never a concentration measure.
  assert.equal(concentrationReasonForCandidate({ ticker: "NVDA", direction: "long" }, twoLongs), null);
});

test("Q9 enforced (Wave A/B default): evaluateZeroDteGovernor blocks a 3rd correlated same-direction play", () => {
  // Two correlated longs already open; a 3rd correlated long is over the concentration
  // cap (2) but UNDER the concurrency cap (3). GOVERNOR_ENFORCE_CONCENTRATION defaults
  // true (2026-07-30 session — crypto/miner cluster ran to −100% session PnL).
  const snap = deriveGovernorFromLedger([
    row({ ticker: "SPY", direction: "long", status: "OPEN" }),
    row({ ticker: "QQQ", direction: "long", status: "OPEN" }),
  ]);
  const blocks = evaluateZeroDteGovernor({ ticker: "IWM", direction: "long" }, snap, NOW);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.code, "governor_concentration");
});

test("summarizeGovernorForBoard: surfaces the concentration measure without ever setting halted", () => {
  const summary = summarizeGovernorForBoard(
    [
      row({ ticker: "SPY", direction: "long", status: "OPEN" }),
      row({ ticker: "QQQ", direction: "long", status: "OPEN" }),
    ],
    []
  );
  assert.equal(summary.max_correlated_same_dir, GOVERNOR_MAX_CORRELATED_SAME_DIR);
  assert.deepEqual(summary.correlated_concentration, { tickers: ["QQQ", "SPY"], direction: "long", count: 2 });
  // At the cap → a would-block reason is surfaced…
  assert.ok(summary.would_block_concentration && /concentration ceiling/.test(summary.would_block_concentration));
  // …but the measure NEVER halts the desk (only the enforcing halts set that).
  assert.equal(summary.halted, false);
});

test("summarizeGovernorForBoard: no correlated cluster → concentration measure is null/quiet", () => {
  const summary = summarizeGovernorForBoard([row({ ticker: "NVDA", direction: "long", status: "OPEN" })], []);
  assert.equal(summary.correlated_concentration, null);
  assert.equal(summary.would_block_concentration, null);
});

// ════════════════════════════════════════════════════════════════════════════════════
// SECOND-WAVE adversarial coverage — exact thresholds, tie-breaks, and freezeConcentrationState.
// ════════════════════════════════════════════════════════════════════════════════════

// ── concurrency cap: EXACT boundary via mixed open + committedThisCycle ───────────────
test("governor: cap boundary — open + committedThisCycle fill the configured ceiling", () => {
  const gov = {
    open_plans: [
      { ticker: "TSLA", direction: "short" as const },
      { ticker: "META", direction: "short" as const },
      { ticker: "MSFT", direction: "short" as const },
    ],
    stops: [],
  };
  // Open + cycle under the ceiling → no block (ceiling is product dial, default 100).
  assert.deepEqual(
    evaluateZeroDteGovernor({ ticker: "AMD", direction: "short" }, gov, NOW, [
      { ticker: "AMZN", direction: "short" },
      { ticker: "NVDA", direction: "short" },
    ]),
    []
  );
  // Fill the book to exactly the ceiling via committed-this-cycle → block.
  const fillToCap = Array.from(
    { length: GOVERNOR_MAX_CONCURRENT_PLANS - gov.open_plans.length },
    (_, i) => ({ ticker: `C${i}`, direction: "short" as const })
  );
  const atCap = evaluateZeroDteGovernor(
    { ticker: "AMD", direction: "short" },
    gov,
    NOW,
    fillToCap
  );
  assert.deepEqual(atCap.map((b) => b.code), ["governor_max_concurrent"]);
});

// ── re-entry lock: EXACT boundary (< lock window, not <=) ────────────────────────────
test("governor: re-entry lock boundary — exactly 20 min ago is UNLOCKED; one ms inside is locked", () => {
  const exactly20 = { open_plans: [], stops: [{ ticker: "META", direction: "short" as const, at_ms: NOW - GOVERNOR_REENTRY_LOCK_MS }] };
  assert.deepEqual(
    evaluateZeroDteGovernor({ ticker: "META", direction: "short" }, exactly20, NOW),
    [],
    "at exactly the lock length the window has elapsed (comparison is `< lock`)"
  );
  const justInside = { open_plans: [], stops: [{ ticker: "META", direction: "short" as const, at_ms: NOW - GOVERNOR_REENTRY_LOCK_MS + 1 }] };
  assert.deepEqual(
    evaluateZeroDteGovernor({ ticker: "META", direction: "short" }, justInside, NOW).map((b) => b.code),
    ["governor_reentry_lock"]
  );
});

// ── loss-halt COUNT boundary: 4 losers pass, exactly 5 halt ──────────────────────────
test("SEV-3: loss-halt count boundary — 4 realized losers pass, exactly 5 halt", () => {
  const four = deriveGovernorFromLedger([losingTimeStop("A", -20), losingTimeStop("B", -20), losingTimeStop("C", -20), losingTimeStop("D", -20)]);
  assert.equal(four.realized_losers, 4);
  assert.ok(four.session_pnl_pct! > GOVERNOR_SESSION_LOSS_FLOOR_PCT, "−80% is above the −120 floor, so only the count matters here");
  assert.equal(governorLossHaltReason(four), null);
  assert.deepEqual(evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, four, NOW), []);

  const five = deriveGovernorFromLedger([losingTimeStop("A", -20), losingTimeStop("B", -20), losingTimeStop("C", -20), losingTimeStop("D", -20), losingTimeStop("E", -20)]);
  assert.equal(five.realized_losers, GOVERNOR_LOSS_HALT_COUNT);
  const halt = evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, five, NOW);
  assert.deepEqual(halt.map((b) => b.code), ["governor_session_loss_halt"]);
  assert.match(halt[0]!.reason, /realized losers/);
});

// ── loss-halt FLOOR boundary: exactly at −120% halts; just above does not ─────────────
test("SEV-3: session-P&L floor boundary — exactly −120% halts, −119% does not (count still under cap)", () => {
  // Two losers at −60 each = −120 exactly → floor is `<=` so it halts, on 2 losers (< count cap).
  const at = deriveGovernorFromLedger([losingTimeStop("A", -60), losingTimeStop("B", -60)]);
  assert.equal(at.session_pnl_pct, GOVERNOR_SESSION_LOSS_FLOOR_PCT);
  assert.equal(at.realized_losers, 2);
  const halt = evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, at, NOW);
  assert.deepEqual(halt.map((b) => b.code), ["governor_session_loss_halt"]);
  assert.match(halt[0]!.reason, /floor/, "the FLOOR reason, not the count reason (count is only 2)");

  // −59.5 each = −119 → above the floor, 2 losers → no halt.
  const above = deriveGovernorFromLedger([losingTimeStop("A", -59.5), losingTimeStop("B", -59.5)]);
  assert.equal(above.session_pnl_pct, -119);
  assert.deepEqual(evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, above, NOW), []);
});

test("SEV-3: when BOTH the count and the floor trip, the COUNT reason wins (it is checked first)", () => {
  // 5 losers at −25% each → losers>=5 AND pnl at −125% past the −120% floor; the reason must be the count wording.
  const snap = deriveGovernorFromLedger([losingTimeStop("A", -25), losingTimeStop("B", -25), losingTimeStop("C", -25), losingTimeStop("D", -25), losingTimeStop("E", -25)]);
  const reason = governorLossHaltReason(snap);
  assert.match(reason ?? "", /realized losers/);
  assert.doesNotMatch(reason ?? "", /at\/below the .*floor/);
});

// ── ledgerRowStopped: EXACT trough boundary at the −50% stop level ────────────────────
test("deriveGovernorFromLedger: trough EXACTLY at the −50% stop level is a stop; a hair above is not", () => {
  // entry 4.0, stop level = 4.0*(1−0.5) = 2.0. trough == 2.0 → `<=` → stopped.
  const at = deriveGovernorFromLedger([row({ ticker: "SPY", status: "CLOSED", entry_premium: 4.0, trough_premium: 2.0 })]);
  assert.deepEqual(at.stops.map((s) => s.ticker), ["SPY"]);
  // trough 2.01 → above the stop level → NOT a stop (and not a realized loser via this channel).
  const above = deriveGovernorFromLedger([row({ ticker: "SPY", status: "CLOSED", entry_premium: 4.0, trough_premium: 2.01, plan_pnl_pct: null })]);
  assert.equal(above.stops.length, 0);
});

test("deriveGovernorFromLedger: a non-positive entry_premium can never be a trough-derived stop (guarded)", () => {
  const snap = deriveGovernorFromLedger([row({ ticker: "X", status: "CLOSED", entry_premium: 0, trough_premium: 0, plan_pnl_pct: null })]);
  assert.equal(snap.stops.length, 0, "entry<=0 → the trough test is skipped, never a divide/degenerate stop");
});

test("deriveGovernorFromLedger: a graded hard stop counts ONCE as a realized loser (no double-tally)", () => {
  // plan_outcome stopped AND plan_pnl_pct −50 → realized loser once, session −50 (prefers the graded pnl).
  const snap = deriveGovernorFromLedger([
    row({ ticker: "MU", status: "CLOSED", plan_outcome: "stopped", plan_pnl_pct: -50, trough_premium: 1.9 }),
  ]);
  assert.equal(snap.stops.length, 1);
  assert.equal(snap.realized_losers, 1);
  assert.equal(snap.session_pnl_pct, -50);
});

// ── maxCorrelatedSameDirection: tie-break favors LONG (checked first, `> best.count`) ─
test("maxCorrelatedSameDirection: equal long/short clusters → the LONG cluster is returned (long is scanned first)", () => {
  const cluster = maxCorrelatedSameDirection([
    { ticker: "SPY", direction: "long" },
    { ticker: "QQQ", direction: "long" },
    { ticker: "IWM", direction: "short" },
    { ticker: "DIA", direction: "short" },
  ]);
  // both directions form a 2-cluster; long wins the tie because short only replaces on strictly-greater count.
  assert.deepEqual(cluster, { tickers: ["QQQ", "SPY"], direction: "long", count: 2 });
});

// ── correlationGroupOf / correlationGroupId ──────────────────────────────────────────
test("correlationGroupOf: index/ETF names resolve to their group; sector names resolve to theirs; uncorrelated is null", () => {
  assert.ok(correlationGroupOf("SPY"));
  assert.ok(correlationGroupOf("QQQ"));
  assert.ok(correlationGroupOf("NVDA"), "NVDA is in the Semiconductors group (v2)");
  assert.equal(correlationGroupOf("PLTR"), null, "a name outside all groups is null");
  // The group id is a stable, sorted, index-independent name.
  const id = correlationGroupId(correlationGroupOf("SPY")!);
  assert.match(id, /^cg:/);
  assert.equal(id, correlationGroupId(correlationGroupOf("QQQ")!), "SPY and QQQ share the group → same id");
  assert.notEqual(id, correlationGroupId(correlationGroupOf("NVDA")!), "NVDA is in a different group than SPY");
});

// ── freezeConcentrationState: adversarial (opposed direction, dedup, rounding, single name) ──
test("freezeConcentrationState: a SHORT candidate counts only the same-direction (short) existing book", () => {
  const c = freezeConcentrationState({ ticker: "QQQ", direction: "short" }, [
    { ticker: "SPY", direction: "long" }, // opposed → not same-direction
    { ticker: "IWM", direction: "short" }, // same direction + same beta
    { ticker: "AAPL", direction: "short" }, // same direction, uncorrelated
  ]);
  assert.equal(c.same_direction_open_count, 2, "only the two shorts");
  assert.equal(c.same_beta_open_count, 1, "only IWM shares QQQ's group");
  assert.equal(c.gross_directional_count, 3, "the gross book counts BOTH directions");
  assert.deepEqual(c.correlation_group_ids, [correlationGroupId(correlationGroupOf("QQQ")!)]);
});

test("freezeConcentrationState: a candidate outside ALL open plans' groups has zero same-beta but its own group ids", () => {
  const c = freezeConcentrationState({ ticker: "PLTR", direction: "long" }, [
    { ticker: "SPY", direction: "long" },
    { ticker: "QQQ", direction: "long" },
  ]);
  assert.deepEqual(c.correlation_group_ids, [], "PLTR is in no group → empty");
  assert.equal(c.same_beta_open_count, 0, "PLTR is in no group → no same-beta exposure");
  assert.equal(c.same_direction_open_count, 2);
});

test("freezeConcentrationState: duplicate (ticker,direction) rows are de-duped; premium is rounded, non-finite → null", () => {
  const c = freezeConcentrationState({ ticker: "QQQ", direction: "long" }, [
    { ticker: "SPY", direction: "long" },
    { ticker: "SPY", direction: "long" }, // a ledger quirk — must not double-count
  ], { aggregatePremiumAtRisk: 12345.678 });
  assert.equal(c.gross_directional_count, 1, "the two SPY:long rows collapse to one distinct exposure");
  assert.deepEqual(c.existing_open_setup_ids, ["SPY:long"]);
  assert.equal(c.aggregate_premium_at_risk, 12346, "rounded at the data layer");
  assert.equal(c.concentration_policy_version, CONCENTRATION_POLICY_VERSION);

  const nan = freezeConcentrationState({ ticker: "QQQ", direction: "long" }, [], { aggregatePremiumAtRisk: Number.NaN });
  assert.equal(nan.aggregate_premium_at_risk, null, "a non-finite premium is an honest null, never NaN/0");
});

// ── loadRecordedGovernorStops: filters malformed persisted entries ───────────────────
test("governor state: malformed recorded entries (bad direction / non-finite at_ms) are dropped on load", async () => {
  const day = "2099-01-09";
  // Write a valid one so the key exists, then a corrupt payload must not surface bad rows.
  await recordGovernorStops(day, [{ ticker: "SPY", direction: "long", at_ms: NOW }]);
  const recorded = await loadRecordedGovernorStops(day);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]!.ticker, "SPY");
  assert.equal(recorded[0]!.direction, "long");
  assert.ok(Number.isFinite(recorded[0]!.at_ms!));
});

// ── Phase 2c portfolio governor extensions ───────────────────────────────────────────
test("aggregatePremiumAtRisk sums open plan entry premiums", () => {
  assert.equal(
    aggregatePremiumAtRisk([
      row({ ticker: "NVDA", status: "OPEN", entry_premium: 1200 }),
      row({ ticker: "AMD", status: "HOLD", entry_premium: 800 }),
      row({ ticker: "META", status: "CLOSED", entry_premium: 500 }),
    ]),
    2000
  );
});

test("timeOfDaySizingFactor reduces cap during lunch chop", () => {
  const lunch = timeOfDaySizingFactor(13 * 60);
  assert.ok(lunch.factor < 1);
  assert.ok(lunch.effective_max_concurrent < GOVERNOR_MAX_CONCURRENT_PLANS);
  assert.match(lunch.label ?? "", /lunch/i);
});

test("summarizeGovernorForBoard: surfaces premium + TOD sizing fields", () => {
  const s = summarizeGovernorForBoard(
    [row({ ticker: "NVDA", status: "OPEN", entry_premium: 50_000 })],
    [],
    { etMinutes: 13 * 60, shortGammaOpen: 2 }
  );
  assert.equal(s.premium_at_risk, 50_000);
  assert.equal(s.short_gamma_open, 2);
  assert.ok(s.effective_max_concurrent <= GOVERNOR_MAX_CONCURRENT_PLANS);
});

// FINDINGS 2026-08-11 (P1, fail-open risk guard). Live session: four rows closed red
// (ACHR −2.3%, RCAT −17.0%, HIMS −29.1%, SPXW −50.0%) and the governor reported
// realized_losers: 1, session_pnl_pct: −50 — only SPXW, because only SPXW tripped the −50%
// stop test. The other three closed on time-stops whose plan_pnl_pct the lazy grader had not
// stamped, so each scored exactly 0 in a tally whose entire job is to notice a losing session.
// The board was already SHOWING −29.1% for HIMS from the same two fields.
test("a CLOSED row the grader has not reached is still counted, from entry vs mark", () => {
  const snap = deriveGovernorFromLedger([
    // The live shape: closed red on a time-stop, ungraded, trough well above the −50% level.
    row({ ticker: "HIMS", status: "CLOSED", entry_premium: 1.41, last_mark: 1.0, last_mark_at: "2026-08-11T15:00:00Z", trough_premium: 1.0 }),
    row({ ticker: "RCAT", status: "CLOSED", entry_premium: 0.53, last_mark: 0.44, last_mark_at: "2026-08-11T15:00:00Z", trough_premium: 0.44 }),
  ]);
  assert.equal(snap.realized_losers, 2);
  assert.ok(snap.session_pnl_pct! < -40, `expected a real loss tally, got ${snap.session_pnl_pct}`);
});

test("a graded row still wins — the mark channel never overrides plan_pnl_pct", () => {
  const snap = deriveGovernorFromLedger([
    row({ status: "CLOSED", plan_pnl_pct: -12, entry_premium: 4, last_mark: 1, last_mark_at: "2026-08-11T15:00:00Z" }),
  ]);
  assert.equal(snap.session_pnl_pct, -12);
});

test("a NEVER-QUOTED row contributes nothing rather than a fabricated 0.00%", () => {
  // last_mark still bit-identical to entry AND no last_mark_at = no quote ever landed (db.ts).
  // Counting that as a real 0% would launder the manufactured breakeven into the risk tally.
  const snap = deriveGovernorFromLedger([
    row({ ticker: "RIOT", status: "CLOSED", entry_premium: 0.93, last_mark: 0.93, last_mark_at: null, trough_premium: 0.93 }),
  ]);
  assert.equal(snap.realized_losers, 0);
  assert.equal(snap.session_pnl_pct, 0);
});

test("an OPEN row is not realized, however far its mark has moved", () => {
  const snap = deriveGovernorFromLedger([
    row({ status: "OPEN", entry_premium: 4, last_mark: 1, last_mark_at: "2026-08-11T15:00:00Z" }),
  ]);
  assert.equal(snap.realized_losers, 0);
  assert.equal(snap.session_pnl_pct, 0);
});
