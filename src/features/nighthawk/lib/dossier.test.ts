import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

// Night Hawk Legacy Signal Intelligence, Phase 1.6: earningsDateForTicker is the pure lookup
// fetchTickerDossier now calls (via an optional DossierSessionContext) to populate
// scoreCandidate's earnings_date/today_ymd/tomorrow_ymd -- previously always null on the FIRST
// dossier scoring pass because fetchTickerDossier never received session dates at all (only the
// downstream edition-builder.ts rescore did). Duplicated from hunt-builder.ts's own identical
// private helper (not imported, to avoid a circular import -- hunt-builder.ts imports
// fetchAllDossiers FROM dossier.ts).
test("earningsDateForTicker: ticker present in tomorrow_earnings returns tomorrow's date", async () => {
  const { earningsDateForTicker } = await import("./dossier");
  const result = earningsDateForTicker("NVDA", [{ ticker: "NVDA" }], "2026-09-18");
  assert.equal(result, "2026-09-18");
});

test("earningsDateForTicker: ticker absent from tomorrow_earnings returns null", async () => {
  const { earningsDateForTicker } = await import("./dossier");
  const result = earningsDateForTicker("NVDA", [{ ticker: "AMD" }], "2026-09-18");
  assert.equal(result, null);
});

test("earningsDateForTicker: an empty tomorrow_earnings list returns null", async () => {
  const { earningsDateForTicker } = await import("./dossier");
  assert.equal(earningsDateForTicker("NVDA", [], "2026-09-18"), null);
});

test("earningsDateForTicker: matches case-insensitively (lowercase ticker arg, uppercase row value)", async () => {
  const { earningsDateForTicker } = await import("./dossier");
  const result = earningsDateForTicker("nvda", [{ ticker: "NVDA" }], "2026-09-18");
  assert.equal(result, "2026-09-18");
});

test("earningsDateForTicker: falls back to a row's `symbol` field when `ticker` is absent", async () => {
  const { earningsDateForTicker } = await import("./dossier");
  const result = earningsDateForTicker("NVDA", [{ symbol: "nvda" }], "2026-09-18");
  assert.equal(result, "2026-09-18");
});

test("earningsDateForTicker: a row with neither ticker nor symbol never matches", async () => {
  const { earningsDateForTicker } = await import("./dossier");
  const result = earningsDateForTicker("NVDA", [{ some_other_field: "NVDA" }], "2026-09-18");
  assert.equal(result, null);
});

// Source-inspection proof (same convention as db.test.ts): fetchTickerDossier's real dependency
// graph (Polygon/UW fan-out) is disproportionate to mock for what is fundamentally a "does this
// object literal carry these three keys, wired from the right values" question. Reading the raw
// source and asserting the scoreCandidate call site is a valid RED->GREEN proof: it fails before
// the fix (those field names/expressions did not exist in the object literal at all) and passes
// after.
test("fetchTickerDossier: the scoreCandidate call site wires earnings_date/today_ymd/tomorrow_ymd from sessionCtx", () => {
  const source = readFileSync(fileURLToPath(new URL("./dossier.ts", import.meta.url)), "utf8");
  assert.match(source, /earnings_date:\s*earningsDate,/);
  assert.match(source, /today_ymd:\s*sessionCtx\?\.today\s*\?\?\s*null,/);
  assert.match(source, /tomorrow_ymd:\s*sessionCtx\?\.tomorrow\s*\?\?\s*null,/);
  assert.match(
    source,
    /const earningsDate = sessionCtx\s*\n\s*\?\s*earningsDateForTicker\(sym, sessionCtx\.tomorrow_earnings, sessionCtx\.tomorrow\)\s*\n\s*:\s*null;/
  );
});
