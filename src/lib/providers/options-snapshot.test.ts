import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Locks the Massive UNIFIED-SNAPSHOT mapper + chunking + per-OCC cache reader for Night's
// Watch. The mapper must read the VERIFIED doc field paths, honor the MARK priority
// (last_quote.midpoint ?? mid(bid,ask) ?? last_trade.price), SKIP error/unfound rows, and
// NEVER fabricate a price. Chunking must split >250 OCCs into ≤250 batches. The cache
// reader must round-trip an in-mem snapshot and treat a missing OCC as null.
//
// Dynamic import inside each test (the module pulls in @/lib/* transitively); ensure no
// API key is set so fetchOptionsUnifiedSnapshot's not-configured path never hits network.
delete process.env.POLYGON_API_KEY;
delete process.env.MASSIVE_API_KEY;

// ---------------------------------------------------------------------------
// Mock the wire call ONLY (polygonRawJson) for the O:-prefix regression tests below — every
// OTHER test in this file never touches these two mutable knobs, so it keeps exercising the
// real "no API key configured → polygonRawJson short-circuits to null" path unmodified.
// Same established pattern as gex-positioning.test.ts's mock.module("./polygon-options-gex", ...).
let mockSnapshotResult: { results?: unknown[] } | null = null;
let lastSnapshotPath: string | null = null;
mock.module("./polygon-options-gex", {
  namedExports: {
    polygonRawJson: async (path: string) => {
      lastSnapshotPath = path;
      return mockSnapshotResult;
    },
  },
});

// ----------------------------- mapper (doc-shaped fixture) -----------------------------

test("mapper: a full options result maps every field via the exact doc paths", async () => {
  const { mapUnifiedSnapshotResult } = await import("./options-snapshot");
  const r = {
    ticker: "O:SPXW250620C05850000",
    type: "options",
    name: "SPXW 5850 CALL",
    market_status: "open",
    break_even_price: 5860,
    implied_volatility: 0.21,
    open_interest: 1234,
    greeks: { delta: 0.55, gamma: 0.01, theta: -0.4, vega: 1.2 },
    // midpoint (10.3) is DELIBERATELY != mid(bid,ask) (10.2) to prove C2: the mapper ignores the
    // provider midpoint and uses computed mid — matching the chain ladder for the same bid/ask.
    last_quote: { bid: 10.0, ask: 10.4, bid_size: 5, ask_size: 7, midpoint: 10.3, last_updated: 1 },
    last_trade: { price: 10.1, size: 2, exchange: 1, conditions: [], timeframe: "REAL-TIME" },
    details: {
      strike_price: 5850,
      contract_type: "call",
      exercise_style: "european",
      expiration_date: "2025-06-20",
      underlying_ticker: "I:SPX",
    },
    underlying_asset: { price: 5872.5, ticker: "I:SPX", last_updated: 1 },
    session: { close: 9.85, open: 9.9, high: 10.5, low: 9.7, change: -0.05, change_percent: -0.5, volume: 4200 },
  };
  const snap = mapUnifiedSnapshotResult(r);
  assert.ok(snap);
  assert.equal(snap!.ticker, "O:SPXW250620C05850000");
  // MARK = mid(bid,ask) = (10.0+10.4)/2 = 10.2 — NOT the provider midpoint (10.3); matches the chain.
  assert.equal(snap!.mark, 10.2);
  assert.equal(snap!.bid, 10.0);
  assert.equal(snap!.ask, 10.4);
  assert.equal(snap!.last, 10.1);
  assert.equal(snap!.dayClose, 9.85);
  assert.equal(snap!.delta, 0.55);
  assert.equal(snap!.gamma, 0.01);
  assert.equal(snap!.theta, -0.4);
  assert.equal(snap!.vega, 1.2);
  assert.equal(snap!.iv, 0.21);
  assert.equal(snap!.openInterest, 1234);
  assert.equal(snap!.underlyingPrice, 5872.5);
  assert.equal(snap!.strike, 5850);
  assert.equal(snap!.optionType, "call");
  assert.equal(snap!.expiry, "2025-06-20");
});

test("mapper: an error/unfound row is SKIPPED (null) — never fabricated", async () => {
  const { mapUnifiedSnapshotResult } = await import("./options-snapshot");
  const r = {
    ticker: "O:SPXW250620C09999000",
    error: "NOT_FOUND",
    message: "Ticker not found.",
  };
  assert.equal(mapUnifiedSnapshotResult(r), null);
});

test("mapper: midpoint missing → falls back to mid(bid,ask)", async () => {
  const { mapUnifiedSnapshotResult } = await import("./options-snapshot");
  const r = {
    ticker: "O:AAPL250620C00200000",
    type: "options",
    last_quote: { bid: 3.0, ask: 3.4 }, // no midpoint
    details: { strike_price: 200, contract_type: "call", expiration_date: "2025-06-20" },
  };
  const snap = mapUnifiedSnapshotResult(r);
  assert.ok(snap);
  // mid of 3.0 / 3.4 = 3.2
  assert.equal(snap!.mark, 3.2);
});

test("mapper: no midpoint, no usable quote → last_trade.price", async () => {
  const { mapUnifiedSnapshotResult } = await import("./options-snapshot");
  const r = {
    ticker: "O:AAPL250620P00190000",
    type: "options",
    last_quote: { bid: 0, ask: 0 }, // ask 0 → not a real quote
    last_trade: { price: 1.75 },
    details: { strike_price: 190, contract_type: "put", expiration_date: "2025-06-20" },
  };
  const snap = mapUnifiedSnapshotResult(r);
  assert.ok(snap);
  assert.equal(snap!.mark, 1.75);
  assert.equal(snap!.optionType, "put");
});

test("mapper: no usable price anywhere → mark null (never fabricated), other fields kept", async () => {
  const { mapUnifiedSnapshotResult } = await import("./options-snapshot");
  const r = {
    ticker: "O:AAPL250620C00500000",
    type: "options",
    greeks: { delta: 0.05 },
    open_interest: 10,
    details: { strike_price: 500, contract_type: "call", expiration_date: "2025-06-20" },
  };
  const snap = mapUnifiedSnapshotResult(r);
  assert.ok(snap);
  assert.equal(snap!.mark, null);
  assert.equal(snap!.delta, 0.05);
  assert.equal(snap!.openInterest, 10);
});

// -------------------- underlying spot: index `.value` vs stock `.price` --------------------

test("mapper: INDEX OCC with underlying_asset.value (no .price) → underlyingPrice = value, not null", async () => {
  const { mapUnifiedSnapshotResult } = await import("./options-snapshot");
  const r = {
    ticker: "O:SPXW250620C05850000",
    type: "options",
    // Index snapshots carry the underlying under `.value` (an index has no trade "price").
    underlying_asset: { value: 5872.5, ticker: "I:SPX", last_updated: 1 },
    details: { strike_price: 5850, contract_type: "call", expiration_date: "2025-06-20" },
  };
  const snap = mapUnifiedSnapshotResult(r);
  assert.ok(snap);
  assert.equal(snap!.underlyingPrice, 5872.5);
});

test("mapper: STOCK OCC with underlying_asset.price still resolves the spot", async () => {
  const { mapUnifiedSnapshotResult } = await import("./options-snapshot");
  const r = {
    ticker: "O:AAPL250620C00200000",
    type: "options",
    underlying_asset: { price: 201.34, ticker: "AAPL", last_updated: 1 },
    details: { strike_price: 200, contract_type: "call", expiration_date: "2025-06-20" },
  };
  const snap = mapUnifiedSnapshotResult(r);
  assert.ok(snap);
  assert.equal(snap!.underlyingPrice, 201.34);
});

test("mapper: neither .price nor .value present → underlyingPrice null (never fabricated)", async () => {
  const { mapUnifiedSnapshotResult } = await import("./options-snapshot");
  const r = {
    ticker: "O:SPXW250620C05850000",
    type: "options",
    underlying_asset: { ticker: "I:SPX", last_updated: 1 },
    details: { strike_price: 5850, contract_type: "call", expiration_date: "2025-06-20" },
  };
  const snap = mapUnifiedSnapshotResult(r);
  assert.ok(snap);
  assert.equal(snap!.underlyingPrice, null);
});

// -------------------- IV unit guard (normalizeImpliedVol) --------------------

test("normalizeImpliedVol: real decimal IV passes through untouched; percent-scale placeholder rescales", async () => {
  const { normalizeImpliedVol } = await import("./options-snapshot");
  // Live decimals are NEVER rescaled.
  assert.equal(normalizeImpliedVol(0.229), 0.229);
  assert.equal(normalizeImpliedVol(3.0), 3.0); // extreme-but-real 300% vol stays as-is
  // Unmistakable percent-scale placeholders (>= 500%) → /100.
  assert.equal(normalizeImpliedVol(20), 0.2);
  assert.equal(normalizeImpliedVol(15.83), 0.1583);
  // Non-finite → null; 0/negative left as-is for the caller.
  assert.equal(normalizeImpliedVol(null), null);
  assert.equal(normalizeImpliedVol(undefined), null);
  assert.equal(normalizeImpliedVol(0), 0);
});

// -------------------- D3: quote-freshness timestamp (ns → epoch ms) --------------------
// last_quote.last_updated on this endpoint is a NANOSECOND epoch (probe-verified live:
// a real SPY chain row read 1784923199637468200 ~1.78e18 = 2026-07-24T19:59:59.637Z once
// /1e6). The mapper must convert ns→ms so the WS-04 `stale` predicate (plan.ts) can measure
// a real age; absence/garbage must map to null (predicate stays dormant, never fabricated).

test("nsToEpochMs: a realistic nanosecond quote clock → correct epoch ms; garbage → null", async () => {
  const { nsToEpochMs } = await import("./options-snapshot");
  // Real probe-captured value: 1784923199637468200 ns → 1784923199637 ms.
  assert.equal(nsToEpochMs(1784923199637468200), 1784923199637);
  // Sanity: that ms is the prior session's ~4pm-ET close, not an overflowed far-future date.
  assert.equal(new Date(1784923199637).toISOString(), "2026-07-24T19:59:59.637Z");
  // Absent / zero / non-finite / sub-ms sentinel → null (absence is NOT staleness).
  assert.equal(nsToEpochMs(undefined), null);
  assert.equal(nsToEpochMs(null), null);
  assert.equal(nsToEpochMs(0), null);
  assert.equal(nsToEpochMs(-5), null);
  assert.equal(nsToEpochMs(1), null); // 1 ns → 0 ms → treated as absent, not epoch-1970
  assert.equal(nsToEpochMs("not-a-number"), null);
});

test("mapper: last_quote.last_updated (ns) → quoteUpdatedMs (ms), yielding a sane age", async () => {
  const { mapUnifiedSnapshotResult } = await import("./options-snapshot");
  // A quote stamped 30s before an anchor "now" — realistic nanosecond epoch.
  const nowMs = 1784923200000;
  const ns = (nowMs - 30_000) * 1e6; // 1.78e18-scale nanoseconds
  const snap = mapUnifiedSnapshotResult({
    ticker: "O:SPY260724C00600000",
    type: "options",
    last_quote: { bid: 2.3, ask: 2.5, last_updated: ns },
    details: { strike_price: 600, contract_type: "call", expiration_date: "2026-07-24" },
  });
  assert.ok(snap);
  assert.equal(snap!.quoteUpdatedMs, nowMs - 30_000);
  // The conversion yields a SANE age (30s), not an overflowed one — catches a future
  // unit regression (ms-vs-ns) that would make every quote read as absurdly old or fresh.
  const ageMs = nowMs - snap!.quoteUpdatedMs!;
  assert.equal(ageMs, 30_000);
  assert.ok(ageMs > 0 && ageMs < 60 * 60 * 1000);
});

test("mapper: NO last_quote.last_updated → quoteUpdatedMs null (age predicate stays dormant)", async () => {
  const { mapUnifiedSnapshotResult } = await import("./options-snapshot");
  const snap = mapUnifiedSnapshotResult({
    ticker: "O:AAPL260724C00200000",
    type: "options",
    last_quote: { bid: 3.0, ask: 3.4 }, // no last_updated
    details: { strike_price: 200, contract_type: "call", expiration_date: "2026-07-24" },
  });
  assert.ok(snap);
  assert.equal(snap!.quoteUpdatedMs, null);
});

// ----------------------------- chunking (>250) -----------------------------

test("chunkOccs splits >250 into ≤250 batches with no loss or overlap", async () => {
  const { chunkOccs, UNIFIED_SNAPSHOT_MAX_PER_CALL } = await import("./options-snapshot");
  assert.equal(UNIFIED_SNAPSHOT_MAX_PER_CALL, 250);

  const occs = Array.from({ length: 603 }, (_, i) => `O:T${i}`);
  const chunks = chunkOccs(occs, UNIFIED_SNAPSHOT_MAX_PER_CALL);
  assert.equal(chunks.length, 3); // 250 + 250 + 103
  assert.equal(chunks[0].length, 250);
  assert.equal(chunks[1].length, 250);
  assert.equal(chunks[2].length, 103);
  // every chunk respects the cap
  for (const c of chunks) assert.ok(c.length <= 250);
  // flatten == original (no loss, no dupes, order preserved)
  assert.deepEqual(chunks.flat(), occs);
});

test("chunkOccs: exact multiple of 250 yields full chunks only", async () => {
  const { chunkOccs } = await import("./options-snapshot");
  const occs = Array.from({ length: 500 }, (_, i) => `O:X${i}`);
  const chunks = chunkOccs(occs, 250);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 250);
  assert.equal(chunks[1].length, 250);
});

test("fetchOptionsUnifiedSnapshot: empty/whitespace input → empty map (no upstream)", async () => {
  const { fetchOptionsUnifiedSnapshot } = await import("./options-snapshot");
  const empty = await fetchOptionsUnifiedSnapshot([]);
  assert.equal(empty.size, 0);
});

test("fetchOptionsUnifiedSnapshot: not configured (no key) → empty map, never throws", async () => {
  const { fetchOptionsUnifiedSnapshot } = await import("./options-snapshot");
  // No POLYGON_API_KEY set → polygonRawJson short-circuits to null → empty map.
  const out = await fetchOptionsUnifiedSnapshot(["O:SPXW250620C05850000", "O:SPXW250620C05850000"]);
  assert.equal(out.size, 0);
});

// -------------- REGRESSION: bare OCC must be O:-prefixed on the wire, but keyed --------------
// -------------- back by the CALLER's original (possibly bare) string ---------------------------
//
// LIVE-VERIFIED 2026-09-02: `/v3/snapshot?ticker.any_of=` on BOTH api.massive.com and
// api.polygon.io returns `{"error":"NOT_FOUND"}` for a bare OCC (e.g. "MU260904C00930000") and a
// full live quote for the SAME contract `O:`-prefixed. `buildOccContractId`
// (src/lib/helix/occ-contract-id.ts) deliberately returns BARE OCC (its own header comment: UW
// wants it bare) — correct for its UW callers, but Legacy's `resolveLegacyPlayOcc` also uses it
// and fed the bare result straight into this function via `legacy-marks/route.ts`, which is the
// one confirmed-broken caller: reproduced live via GET /api/market/nighthawk/legacy-marks on
// 2026-09-02 (all 5 real open Legacy contracts during RTH returned mark:null/stale:true). The
// OTHER `fetchOptionsUnifiedSnapshot` callers (zerodte scan/live-marks/contract-attach,
// banger-live-sync, option-chain-prompt, Vector contract-picks/pick-sweep) already use a
// DIFFERENT builder (`buildOcc` in options-socket.ts, or Vector's `vectorPickOcc`) that returns
// `O:`-prefixed OCC and were verified unaffected — this fix protects them too, since any FUTURE
// caller built the bare way would otherwise silently reproduce the same defect.

test("withOccPrefix: adds O: to a bare OCC, leaves an already-prefixed one untouched", async () => {
  const { withOccPrefix } = await import("./options-snapshot");
  assert.equal(withOccPrefix("MU260904C00930000"), "O:MU260904C00930000");
  assert.equal(withOccPrefix("O:MU260904C00930000"), "O:MU260904C00930000");
  assert.equal(withOccPrefix("  MU260904C00930000  "), "O:MU260904C00930000");
});

test("fetchOptionsUnifiedSnapshot: a BARE OCC is sent O:-prefixed on the wire (the live defect)", async () => {
  const { fetchOptionsUnifiedSnapshot } = await import("./options-snapshot");
  mockSnapshotResult = { results: [] };
  lastSnapshotPath = null;
  await fetchOptionsUnifiedSnapshot(["MU260904C00930000"]);
  assert.ok(lastSnapshotPath, "polygonRawJson was called");
  // The regression: pre-fix this asserted the OPPOSITE (bare on the wire) and failed live.
  assert.ok(
    lastSnapshotPath!.includes("ticker.any_of=O%3AMU260904C00930000") ||
      lastSnapshotPath!.includes("ticker.any_of=O:MU260904C00930000"),
    `expected an O:-prefixed ticker.any_of, got: ${lastSnapshotPath}`
  );
  mockSnapshotResult = null;
});

test("fetchOptionsUnifiedSnapshot: caller's bare OCC is the map key even though the wire request was O:-prefixed", async () => {
  const { fetchOptionsUnifiedSnapshot } = await import("./options-snapshot");
  const bareOcc = "MU260904C00930000";
  mockSnapshotResult = {
    results: [
      {
        // Provider echoes back EXACTLY the ticker form it was asked for (O:-prefixed, since the
        // fix always normalizes the outgoing request) — verified live in the raw curl capture.
        ticker: "O:MU260904C00930000",
        type: "options",
        last_quote: { bid: 24.75, ask: 25.75 },
        details: { strike_price: 930, contract_type: "call", expiration_date: "2026-09-04" },
      },
    ],
  };
  const out = await fetchOptionsUnifiedSnapshot([bareOcc]);
  mockSnapshotResult = null;

  // The caller passed a BARE occ and must be able to look it up the SAME way — this is what
  // legacy-marks/route.ts, vector-pick-sweep.ts, scan.ts, etc. all do (`snaps.get(occ)` with
  // their own un-normalized string). Pre-fix this key was "O:MU260904C00930000" (the provider's
  // canonical form) and `snaps.get(bareOcc)` returned undefined — every mark null/stale.
  assert.equal(out.size, 1);
  const snap = out.get(bareOcc);
  assert.ok(snap, "snapshot must be keyed by the caller's ORIGINAL bare OCC");
  assert.equal(snap!.mark, 25.25); // mid(24.75, 25.75)
  assert.equal(out.get("O:MU260904C00930000"), undefined, "must NOT be keyed by the canonical form instead");
});

test("fetchOptionsUnifiedSnapshot: an already-O:-prefixed caller (Swing's convention) is unaffected", async () => {
  const { fetchOptionsUnifiedSnapshot } = await import("./options-snapshot");
  const occ = "O:MU260904C00930000";
  mockSnapshotResult = {
    results: [
      {
        ticker: occ,
        type: "options",
        last_quote: { bid: 24.75, ask: 25.75 },
        details: { strike_price: 930, contract_type: "call", expiration_date: "2026-09-04" },
      },
    ],
  };
  const out = await fetchOptionsUnifiedSnapshot([occ]);
  mockSnapshotResult = null;
  assert.equal(out.size, 1);
  assert.ok(out.get(occ));
});

test("fetchOptionsUnifiedSnapshot: diag.unfound/missing/noQuote stay keyed by the caller's original OCC", async () => {
  const { fetchOptionsUnifiedSnapshot } = await import("./options-snapshot");
  const bareOcc = "ZZZZ260904C00001000";
  mockSnapshotResult = {
    results: [{ ticker: "O:ZZZZ260904C00001000", error: "NOT_FOUND", message: "Ticker not found." }],
  };
  const diag = { requested: 0, found: 0, unfound: [] as Array<{ occ: string; reason: string }>, missing: [] as string[], noQuote: [] as string[] };
  const out = await fetchOptionsUnifiedSnapshot([bareOcc], diag);
  mockSnapshotResult = null;
  assert.equal(out.size, 0);
  assert.deepEqual(diag.unfound, [{ occ: bareOcc, reason: "Ticker not found." }]);
  assert.deepEqual(diag.missing, []); // a row DID come back (as an error row) — not "no row at all"
});

// ----------------------------- per-OCC cache reader -----------------------------

test("getOptionSnapshot: round-trips a warmed in-mem snapshot by OCC", async () => {
  const { setOptionSnapshots, getOptionSnapshot, _resetOptionSnapshotCacheForTest } =
    await import("./options-snapshot");
  _resetOptionSnapshotCacheForTest();

  const occ = "O:SPXW250620C05850000";
  const snap = {
    ticker: occ,
    mark: 10.2,
    bid: 10.0,
    ask: 10.4,
    last: 10.1,
    delta: 0.55,
    gamma: 0.01,
    theta: -0.4,
    vega: 1.2,
    iv: 0.21,
    openInterest: 1234,
    underlyingPrice: 5872.5,
    strike: 5850,
    optionType: "call" as const,
    expiry: "2025-06-20",
  };
  await setOptionSnapshots([snap]);

  const hit = await getOptionSnapshot(occ);
  assert.ok(hit);
  assert.equal(hit!.ticker, occ);
  assert.equal(hit!.mark, 10.2);
  assert.equal(hit!.delta, 0.55);
});

test("getOptionSnapshot: a missing OCC → null (caller falls back to the chain)", async () => {
  const { getOptionSnapshot, _resetOptionSnapshotCacheForTest } = await import("./options-snapshot");
  _resetOptionSnapshotCacheForTest();
  assert.equal(await getOptionSnapshot("O:NOPE000000C00000000"), null);
  assert.equal(await getOptionSnapshot(""), null);
});
