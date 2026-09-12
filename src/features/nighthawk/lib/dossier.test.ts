import test, { mock } from "node:test";
import assert from "node:assert/strict";

// dossier.ts's import chain reaches `import "server-only"` transitively (via gex-positioning.ts)
// — same stub the platform service tests use for this boundary (see zerodte/scan.test.ts).
mock.module("server-only", { namedExports: {} });

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Live-verified 2026-09-12: real UW congress rows carry `filed_at_date` (the STOCK Act
// disclosure date, which can lag the trade by up to 45 days) alongside `transaction_date` (the
// trade date itself). Measuring recency off `transaction_date` alone means a trade disclosed
// TODAY, but executed 40+ days ago, reads as stale and gets dropped from the recent-signal
// window — exactly backwards, since the disclosure is the fresh, market-moving event.
test("parseTradeDate: real congress shape prefers filed_at_date (disclosure) over transaction_date (trade)", async () => {
  const { parseTradeDate } = await import("./dossier");
  const row = { filed_at_date: daysAgo(5), transaction_date: daysAgo(40) };
  const parsed = parseTradeDate(row);
  assert.ok(parsed);
  assert.equal(parsed!.toISOString().slice(0, 10), daysAgo(5));
});

test("isWithinRecentSignalWindow: a congress trade disclosed recently but executed 40+ days ago is IN the window", async () => {
  const { isWithinRecentSignalWindow } = await import("./dossier");
  const row = { filed_at_date: daysAgo(5), transaction_date: daysAgo(40) };
  assert.equal(isWithinRecentSignalWindow(row), true);
});

test("isWithinRecentSignalWindow: without filed_at_date, still correctly falls back to transaction_date", async () => {
  const { isWithinRecentSignalWindow } = await import("./dossier");
  const recentRow = { transaction_date: daysAgo(10) };
  const staleRow = { transaction_date: daysAgo(45) };
  assert.equal(isWithinRecentSignalWindow(recentRow), true);
  assert.equal(isWithinRecentSignalWindow(staleRow), false);
});

// Live-verified 2026-09-12: real UW insider-transaction rows (`/api/insider/transactions`)
// carry `filing_date` (the SEC filing/disclosure date) alongside `transaction_date` (the trade
// date) — same disclosure-vs-trade gap as congress, smaller in magnitude but the same class.
test("parseTradeDate: real insider-transaction shape prefers filing_date (disclosure) over transaction_date (trade)", async () => {
  const { parseTradeDate } = await import("./dossier");
  const row = { filing_date: daysAgo(3), transaction_date: daysAgo(35) };
  const parsed = parseTradeDate(row);
  assert.ok(parsed);
  assert.equal(parsed!.toISOString().slice(0, 10), daysAgo(3));
});

test("isWithinRecentSignalWindow: an insider buy filed recently but transacted 35+ days ago is IN the window", async () => {
  const { isWithinRecentSignalWindow } = await import("./dossier");
  const row = { filing_date: daysAgo(3), transaction_date: daysAgo(35) };
  assert.equal(isWithinRecentSignalWindow(row), true);
});
