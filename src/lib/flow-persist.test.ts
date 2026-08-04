import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isHelixAuditWorthy,
  buildHelixAuditRow,
  normalizeHelixDirection,
  requiredMinPremium,
  dteFromExpiry,
  MIN_PREMIUM,
  MIN_PREMIUM_NEAR_DATED,
  MIN_PREMIUM_FETCH_FLOOR,
} from "./flow-persist";
import type { MarketFlowAlert } from "./providers/unusual-whales";

function flow(overrides: Partial<MarketFlowAlert> = {}): MarketFlowAlert {
  return {
    ticker: "AAPL",
    premium: 1_500_000,
    option_type: "CALL",
    expiry: "2026-07-10",
    strike: 200,
    direction: "bullish",
    score: 88,
    route: "whale",
    alerted_at: "2026-07-03T20:00:00Z",
    alert_rule: null,
    trade_count: null,
    has_sweep: true,
    ...overrides,
  };
}

test("isHelixAuditWorthy: only the whale route qualifies", () => {
  assert.equal(isHelixAuditWorthy("whale"), true);
  assert.equal(isHelixAuditWorthy("0dte"), false);
  assert.equal(isHelixAuditWorthy("stock"), false);
  assert.equal(isHelixAuditWorthy(""), false);
});

test("buildHelixAuditRow: shapes a whale print into the alert_audit_log row contract", () => {
  const row = buildHelixAuditRow("uw:abc123", flow());
  assert.equal(row.alert_type, "helix_whale");
  assert.equal(row.source_table, "flow_alerts");
  assert.deepEqual(row.source_key, { alert_id: "uw:abc123" });
  assert.equal(row.ticker, "AAPL");
  assert.equal(row.direction, "long");
  assert.equal(row.confidence_score, 88);
  assert.match(row.trigger_reason, /\$1,500,000 CALL premium print/);
});

test("buildHelixAuditRow: decision_trace is an array (required by toJsonbParam's array-vs-object contract)", () => {
  const row = buildHelixAuditRow("uw:abc123", flow());
  assert.ok(Array.isArray(row.decision_trace));
  assert.equal(row.decision_trace.length, 1);
  assert.equal(row.decision_trace[0].premium, 1_500_000);
});

test("normalizeHelixDirection: maps HELIX's bullish/bearish vocabulary onto alert_audit_log's long/short convention", () => {
  assert.equal(normalizeHelixDirection("bullish"), "long");
  assert.equal(normalizeHelixDirection("bearish"), "short");
});

test("normalizeHelixDirection: unknown side stays null, never guessed", () => {
  assert.equal(normalizeHelixDirection("unknown"), null);
});

test("buildHelixAuditRow: a bearish (put-side) print writes direction \"short\", not the raw \"bearish\" string", () => {
  const row = buildHelixAuditRow("uw:def456", flow({ direction: "bearish", option_type: "PUT" }));
  assert.equal(row.direction, "short");
});

// ── DTE-aware premium floor (FINDINGS 2026-08-04) ────────────────────────────────────
// A flat $200k floor applied uniformly to every DTE structurally biased FLOW discovery
// toward SPY/QQQ/mega-caps, since a 0DTE contract's absolute premium-per-contract is far
// smaller than a swing/LEAPS contract even for an equally large directional conviction bet.

test("MIN_PREMIUM_NEAR_DATED is strictly lower than MIN_PREMIUM (the whole point of the fix)", () => {
  assert.ok(MIN_PREMIUM_NEAR_DATED < MIN_PREMIUM, "near-dated floor must be lower, or nothing changes");
  assert.equal(MIN_PREMIUM_FETCH_FLOOR, Math.min(MIN_PREMIUM, MIN_PREMIUM_NEAR_DATED));
});

test("requiredMinPremium: 0DTE and 1DTE use the lower near-dated floor", () => {
  assert.equal(requiredMinPremium(0), MIN_PREMIUM_NEAR_DATED);
  assert.equal(requiredMinPremium(1), MIN_PREMIUM_NEAR_DATED);
});

test("requiredMinPremium: 2DTE+ uses the standard (higher) floor", () => {
  assert.equal(requiredMinPremium(2), MIN_PREMIUM);
  assert.equal(requiredMinPremium(30), MIN_PREMIUM);
});

test("requiredMinPremium: null/undefined/non-finite DTE conservatively uses the HIGHER floor (never guesses near-dated)", () => {
  assert.equal(requiredMinPremium(null), MIN_PREMIUM);
  assert.equal(requiredMinPremium(undefined), MIN_PREMIUM);
  assert.equal(requiredMinPremium(NaN), MIN_PREMIUM);
});

test("dteFromExpiry: same-day expiry is 0 DTE", () => {
  const now = Date.parse("2026-08-04T15:00:00Z");
  assert.equal(dteFromExpiry("2026-08-04", now), 0);
});

test("dteFromExpiry: next-day expiry is 1 DTE regardless of time-of-day", () => {
  const now = Date.parse("2026-08-04T23:59:00Z");
  assert.equal(dteFromExpiry("2026-08-05", now), 1);
});

test("dteFromExpiry: a week out is 7 DTE", () => {
  const now = Date.parse("2026-08-04T15:00:00Z");
  assert.equal(dteFromExpiry("2026-08-11", now), 7);
});

test("dteFromExpiry: unparseable expiry returns null, never a fabricated DTE", () => {
  assert.equal(dteFromExpiry("not-a-date", Date.now()), null);
});

test("end-to-end: a $75k same-day SPXW print clears the near-dated floor but would have been dropped under the old flat $200k floor", () => {
  const f = flow({ premium: 75_000, expiry: "2026-08-04" });
  const dte = dteFromExpiry(f.expiry, Date.parse("2026-08-04T15:00:00Z"));
  assert.equal(dte, 0);
  assert.ok(f.premium >= requiredMinPremium(dte), "should clear the near-dated floor");
  assert.ok(f.premium < MIN_PREMIUM, "would NOT have cleared the old flat floor — this is the bug being fixed");
});

test("end-to-end: a $75k 30-day swing print correctly still needs the full standard floor (not weakened)", () => {
  const f = flow({ premium: 75_000, expiry: "2026-09-03" });
  const dte = dteFromExpiry(f.expiry, Date.parse("2026-08-04T15:00:00Z"));
  assert.ok(dte != null && dte > 1);
  assert.ok(f.premium < requiredMinPremium(dte), "a longer-dated print must NOT get the lowered near-dated floor");
});
