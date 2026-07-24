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
  GOVERNOR_MAX_CONCURRENT_PLANS,
  GOVERNOR_MAX_SESSION_STOPS,
  GOVERNOR_REENTRY_LOCK_MS,
  GOVERNOR_LOSS_HALT_COUNT,
  GOVERNOR_SESSION_LOSS_FLOOR_PCT,
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

// ── anti-overfit FIREWALL: value-pin the governor caps (Step 5) ───────────────────────
// The 2026-07-13 forensics showed a seven-stop day; these caps are the ledger's proven brake. A silent
// loosening (max concurrent up, session-stop halt up, re-entry lock down) reintroduces the runaway-loss
// day the record already paid for — so the values are pinned, not just their behavior.
test("FIREWALL: governor caps are pinned (max 3 concurrent, halt after 3 stops, 20-min re-entry lock)", () => {
  assert.equal(GOVERNOR_MAX_CONCURRENT_PLANS, 3);
  assert.equal(GOVERNOR_MAX_SESSION_STOPS, 3);
  assert.equal(GOVERNOR_REENTRY_LOCK_MS, 20 * 60 * 1000);
});

// AUDIT SEV-3 — the realized-loss halt only ever ADDS conservatism; a silent LOOSENING
// (count up, floor down toward 0) would re-open the chop-and-bleed channel it closes.
test("FIREWALL: realized-loss halt thresholds are pinned (3 losers, −120% session floor)", () => {
  assert.equal(GOVERNOR_LOSS_HALT_COUNT, 3);
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

test("governor: concurrency cap at 3 open plans (2 passes, 3 blocks)", () => {
  const two = [
    { ticker: "TSLA", direction: "long" as const },
    { ticker: "AMZN", direction: "long" as const },
  ];
  const ok = evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, { open_plans: two, stops: [] }, NOW);
  assert.deepEqual(ok, []);
  const three = [...two, { ticker: "GOOGL", direction: "long" as const }];
  const blocked = evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, { open_plans: three, stops: [] }, NOW);
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

test("governor: 20-min same-direction re-entry lock — inside blocks, outside/opposite/untimed pass", () => {
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

  // Untimed (ledger-only) stop can't drive the timed lock — never fabricate timing.
  const untimed = { open_plans: [], stops: [{ ticker: "META", direction: "short" as const, at_ms: null }] };
  assert.deepEqual(evaluateZeroDteGovernor({ ticker: "META", direction: "short" }, untimed, NOW), []);
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
  assert.deepEqual(blocks.map((b) => b.code), ["governor_session_stops"]);
  assert.equal(blocks[0]!.threshold, GOVERNOR_LOSS_HALT_COUNT);
  assert.match(blocks[0]!.reason, /realized losers/, "the block names the realized-loss cause");
});

test("SEV-3: the cumulative session-P&L floor halts even below the loser COUNT", () => {
  // Two big losers (−70% each = −140%) sink past the −120% floor before hitting 3 losers.
  const rows = [
    losingTimeStop("A", -70),
    losingTimeStop("B", -70),
  ];
  const snap = deriveGovernorFromLedger(rows);
  assert.equal(snap.realized_losers, 2, "below the count cap");
  assert.ok(snap.session_pnl_pct! <= GOVERNOR_SESSION_LOSS_FLOOR_PCT, "but past the P&L floor");
  const blocks = evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, snap, NOW);
  assert.deepEqual(blocks.map((b) => b.code), ["governor_session_stops"]);
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
