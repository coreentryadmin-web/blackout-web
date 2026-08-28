import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyVectorClosureReason,
  filterVectorClosureRows,
  formatPremiumPct,
  premiumPctTone,
  sortVectorClosureRows,
} from "./vector-pick-log-board-utils.ts";

const row = (partial: Partial<Parameters<typeof filterVectorClosureRows>[0][number]> & { id: number }) => ({
  id: partial.id,
  ticker: partial.ticker ?? "SPY",
  session_date: partial.session_date ?? "2026-08-28",
  contract: partial.contract ?? {
    occ: "OCC",
    side: "call",
    strike: 500,
    expiry: "2026-08-28",
    label: "500C 08/28",
  },
  rank: partial.rank ?? 1,
  role: partial.role ?? null,
  entry_mid: partial.entry_mid ?? 5,
  close_mid: partial.close_mid ?? 4.5,
  premium_pct_from_entry: partial.premium_pct_from_entry ?? -10,
  close_reason: partial.close_reason ?? "Setup invalidated — spot 500 vs 499",
  setup_invalidated: partial.setup_invalidated ?? true,
  spot: partial.spot ?? 500,
  closed_at: partial.closed_at ?? "2026-08-28T14:00:00.000Z",
});

test("classifyVectorClosureReason buckets chase and cap", () => {
  assert.equal(
    classifyVectorClosureReason({ close_reason: "Premium extended +22% since pick — chase risk", setup_invalidated: false }),
    "premium_chase"
  );
  assert.equal(
    classifyVectorClosureReason({ close_reason: "Premium $35.10 above desk cap ($35)", setup_invalidated: false }),
    "premium_cap"
  );
});

test("filterVectorClosureRows: session + reason + ticker", () => {
  const rows = [
    row({ id: 1, ticker: "SPX", session_date: "2026-08-28", setup_invalidated: true }),
    row({ id: 2, ticker: "NVDA", session_date: "2026-08-27", setup_invalidated: false, close_reason: "Premium extended +20%" }),
  ];
  assert.equal(filterVectorClosureRows(rows, { sessionDate: "2026-08-28" }).length, 1);
  assert.equal(filterVectorClosureRows(rows, { reason: "premium_chase" }).length, 1);
  assert.equal(filterVectorClosureRows(rows, { tickerQuery: "sp" }).length, 1);
});

test("sortVectorClosureRows: pct_desc puts highest first", () => {
  const sorted = sortVectorClosureRows(
    [row({ id: 1, premium_pct_from_entry: -5 }), row({ id: 2, premium_pct_from_entry: 20 })],
    "pct_desc"
  );
  assert.equal(sorted[0]?.id, 2);
});

test("premiumPctTone and formatPremiumPct", () => {
  assert.equal(premiumPctTone(12), "bull");
  assert.equal(premiumPctTone(-3), "bear");
  assert.equal(formatPremiumPct(12.4), "+12%");
  assert.equal(formatPremiumPct(-3.2), "-3%");
});
