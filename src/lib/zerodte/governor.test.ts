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

test("maxCorrelatedSameDirection: a single correlated plan (or none) is not a cluster → null", () => {
  assert.equal(maxCorrelatedSameDirection([{ ticker: "SPY", direction: "long" }]), null);
  assert.equal(maxCorrelatedSameDirection([{ ticker: "NVDA", direction: "long" }, { ticker: "AMD", direction: "long" }]), null);
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

test("Q9 measure does NOT enforce: evaluateZeroDteGovernor still commits a 3rd correlated same-direction play", () => {
  // Two correlated longs already open; a 3rd correlated long is over the concentration
  // cap (2) but UNDER the concurrency cap (3). The measure must not block it — Q9 ships
  // as evidence, not gating. (The only block here would be governor_max_concurrent, and
  // 2 open < 3, so there is none.)
  const snap = deriveGovernorFromLedger([
    row({ ticker: "SPY", direction: "long", status: "OPEN" }),
    row({ ticker: "QQQ", direction: "long", status: "OPEN" }),
  ]);
  const blocks = evaluateZeroDteGovernor({ ticker: "IWM", direction: "long" }, snap, NOW);
  assert.deepEqual(blocks, []); // no concentration block, no other block
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
test("governor: cap boundary — 2 live + 1 committed-this-cycle = 3 blocks; 1+1 = 2 commits", () => {
  const gov = { open_plans: [{ ticker: "TSLA", direction: "short" as const }], stops: [] };
  // 1 open + 1 committed = 2 (< cap) → no block
  assert.deepEqual(
    evaluateZeroDteGovernor({ ticker: "AMD", direction: "short" }, gov, NOW, [{ ticker: "AMZN", direction: "short" }]),
    []
  );
  // 1 open + 2 committed = 3 (== cap) → block
  const at3 = evaluateZeroDteGovernor(
    { ticker: "AMD", direction: "short" },
    gov,
    NOW,
    [{ ticker: "AMZN", direction: "short" }, { ticker: "GOOGL", direction: "short" }]
  );
  assert.deepEqual(at3.map((b) => b.code), ["governor_max_concurrent"]);
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

// ── loss-halt COUNT boundary: 2 losers pass, exactly 3 halt ──────────────────────────
test("SEV-3: loss-halt count boundary — 2 realized losers pass, exactly 3 halt", () => {
  const two = deriveGovernorFromLedger([losingTimeStop("A", -30), losingTimeStop("B", -30)]);
  assert.equal(two.realized_losers, 2);
  assert.ok(two.session_pnl_pct! > GOVERNOR_SESSION_LOSS_FLOOR_PCT, "−60% is above the −120 floor, so only the count matters here");
  assert.equal(governorLossHaltReason(two), null);
  assert.deepEqual(evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, two, NOW), []);

  const three = deriveGovernorFromLedger([losingTimeStop("A", -30), losingTimeStop("B", -30), losingTimeStop("C", -30)]);
  assert.equal(three.realized_losers, GOVERNOR_LOSS_HALT_COUNT);
  const halt = evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, three, NOW);
  assert.deepEqual(halt.map((b) => b.code), ["governor_session_stops"]);
  assert.match(halt[0]!.reason, /realized losers/);
});

// ── loss-halt FLOOR boundary: exactly at −120% halts; just above does not ─────────────
test("SEV-3: session-P&L floor boundary — exactly −120% halts, −119% does not (count still under cap)", () => {
  // Two losers at −60 each = −120 exactly → floor is `<=` so it halts, on 2 losers (< count cap).
  const at = deriveGovernorFromLedger([losingTimeStop("A", -60), losingTimeStop("B", -60)]);
  assert.equal(at.session_pnl_pct, GOVERNOR_SESSION_LOSS_FLOOR_PCT);
  assert.equal(at.realized_losers, 2);
  const halt = evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, at, NOW);
  assert.deepEqual(halt.map((b) => b.code), ["governor_session_stops"]);
  assert.match(halt[0]!.reason, /floor/, "the FLOOR reason, not the count reason (count is only 2)");

  // −59.5 each = −119 → above the floor, 2 losers → no halt.
  const above = deriveGovernorFromLedger([losingTimeStop("A", -59.5), losingTimeStop("B", -59.5)]);
  assert.equal(above.session_pnl_pct, -119);
  assert.deepEqual(evaluateZeroDteGovernor({ ticker: "NVDA", direction: "long" }, above, NOW), []);
});

test("SEV-3: when BOTH the count and the floor trip, the COUNT reason wins (it is checked first)", () => {
  // 3 big losers → losers>=3 AND pnl past the floor; the reason must be the count wording.
  const snap = deriveGovernorFromLedger([losingTimeStop("A", -70), losingTimeStop("B", -70), losingTimeStop("C", -70)]);
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
test("correlationGroupOf: index/ETF names resolve to the one v1 group; a single name is null", () => {
  assert.ok(correlationGroupOf("SPY"));
  assert.ok(correlationGroupOf("QQQ"));
  assert.equal(correlationGroupOf("NVDA"), null);
  // The group id is a stable, sorted, index-independent name.
  const id = correlationGroupId(correlationGroupOf("SPY")!);
  assert.match(id, /^cg:/);
  assert.equal(id, correlationGroupId(correlationGroupOf("QQQ")!), "SPY and QQQ share the group → same id");
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

test("freezeConcentrationState: a single-name candidate outside any group has empty group ids + zero same-beta", () => {
  const c = freezeConcentrationState({ ticker: "NVDA", direction: "long" }, [
    { ticker: "SPY", direction: "long" },
    { ticker: "QQQ", direction: "long" },
  ]);
  assert.deepEqual(c.correlation_group_ids, []);
  assert.equal(c.same_beta_open_count, 0, "NVDA is in no group → no same-beta exposure");
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
