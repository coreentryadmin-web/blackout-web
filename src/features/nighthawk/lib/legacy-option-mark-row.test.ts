import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLegacyOptionMarkRow } from "./legacy-option-mark-row.ts";

const NOW = Date.parse("2026-09-02T19:30:00.000Z");

test("buildLegacyOptionMarkRow: REST snapshot mark is fresh when WS is absent", () => {
  const row = buildLegacyOptionMarkRow(
    "MRNA260904C00155000",
    null,
    {
      ticker: "O:MRNA260904C00155000",
      mark: 4.85,
      bid: 4.8,
      ask: 4.9,
      last: null,
      dayClose: null,
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
      iv: null,
      openInterest: null,
      bidSize: null,
      askSize: null,
      dayVolume: null,
      underlyingPrice: null,
      strike: 155,
      optionType: "call",
      expiry: "2026-09-04",
      sharesPerContract: 100,
      quoteUpdatedMs: null,
      observedAtMs: NOW - 5_000,
    },
    NOW
  );
  assert.equal(row.mark, 4.85);
  assert.equal(row.stale, false);
  assert.ok(row.asof);
});

test("buildLegacyOptionMarkRow: no mark anywhere → stale", () => {
  const row = buildLegacyOptionMarkRow("MRNA260904C00155000", null, null, NOW);
  assert.equal(row.mark, null);
  assert.equal(row.stale, true);
});

test("buildLegacyOptionMarkRow: a genuinely stale quote (real last_updated far in the past) is STALE even when our own fetch just succeeded (2026-09-13 fix)", () => {
  // The live bug: a thinly-traded contract's last_quote hasn't moved in 45 minutes, but this
  // server successfully re-fetched it moments ago (observedAtMs = just now). The OLD code
  // preferred observedAtMs, so asof read "just now" and stale was always false — no matter how
  // old the real quote was. quoteUpdatedMs (the real market clock) must win instead.
  const staleQuoteMs = NOW - 45 * 60_000;
  const row = buildLegacyOptionMarkRow(
    "MRNA260904C00155000",
    null,
    {
      ticker: "O:MRNA260904C00155000",
      mark: 4.85,
      bid: 4.8,
      ask: 4.9,
      last: null,
      dayClose: null,
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
      iv: null,
      openInterest: null,
      bidSize: null,
      askSize: null,
      dayVolume: null,
      underlyingPrice: null,
      strike: 155,
      optionType: "call",
      expiry: "2026-09-04",
      sharesPerContract: 100,
      quoteUpdatedMs: staleQuoteMs,
      observedAtMs: NOW, // our own fetch clock — just succeeded, but proves nothing about the quote
    },
    NOW
  );
  assert.equal(row.stale, true, "a 45-min-old real quote must be STALE regardless of fetch recency");
  assert.equal(row.asof, new Date(staleQuoteMs).toISOString(), "asof reflects the real quote clock, not the fetch clock");
});

test("buildLegacyOptionMarkRow: a bid=0 backstop quote wildly divergent from the last real trade falls through to the last trade, not the fabricated mid (cross-lane fix, 2026-09-14)", () => {
  // Same root cause the swing/banger lane fixed same-session (PR #4969/reliableMarkFromSnapshot,
  // options-snapshot.ts): fetchOptionsUnifiedSnapshot's snap.mark can be a market-maker "backstop"
  // bid:0/ask-only midpoint with no real market behind it -- CRSR 260918C00015000 live-reproduced
  // bid:0/ask:15 -> mid $7.50 while last_trade.price was $0.07 (a 107x divergence). That finding's
  // own blast-radius list explicitly names legacy-marks as sharing this exposure via the same
  // fetchOptionsUnifiedSnapshot/OptionSnapshot.mark path, left unfixed pending this decision.
  // buildLegacyOptionMarkRow must apply the same divergence guard to its REST-snapshot mark read.
  const row = buildLegacyOptionMarkRow(
    "CRSR260918C00015000",
    null,
    {
      ticker: "O:CRSR260918C00015000",
      mark: 7.5,
      bid: 0,
      ask: 15,
      last: 0.07,
      dayClose: 0.07,
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
      iv: null,
      openInterest: null,
      bidSize: null,
      askSize: null,
      dayVolume: null,
      underlyingPrice: null,
      strike: 15,
      optionType: "call",
      expiry: "2026-09-18",
      sharesPerContract: 100,
      quoteUpdatedMs: NOW,
      observedAtMs: NOW,
    },
    NOW
  );
  assert.equal(row.mark, 0.07, "a 107x bid=0 divergence must fall through to the real last-trade price, not the fabricated $7.50 mid");
});

test("buildLegacyOptionMarkRow: a real two-sided market (bid>0) is never second-guessed even with a large mid-vs-last divergence", () => {
  const row = buildLegacyOptionMarkRow(
    "MRNA260904C00155000",
    null,
    {
      ticker: "O:MRNA260904C00155000",
      mark: 7.5,
      bid: 5,
      ask: 10,
      last: 0.07,
      dayClose: 0.07,
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
      iv: null,
      openInterest: null,
      bidSize: null,
      askSize: null,
      dayVolume: null,
      underlyingPrice: null,
      strike: 155,
      optionType: "call",
      expiry: "2026-09-04",
      sharesPerContract: 100,
      quoteUpdatedMs: NOW,
      observedAtMs: NOW,
    },
    NOW
  );
  assert.equal(row.mark, 7.5, "a real bid behind the quote must never be second-guessed against last-trade divergence");
});

test("buildLegacyOptionMarkRow: a WS tick timestamped minutes ahead of now is stale, not treated as freshest", () => {
  // A future ts (clock skew between the quote source and this server, or a corrupted field)
  // previously made the raw `nowMs - asofMs` age negative, which never exceeded
  // ZERODTE_MARK_STALE_MS — so a garbage future-dated mark read as the freshest possible quote
  // instead of untrustworthy. Well beyond ZERODTE_MARK_FUTURE_TOLERANCE_MS (60s) so this is
  // unambiguously the "corrupted timestamp" case, not the "+30s test-fixture headroom" case
  // isZeroDteMarkStale's own tests (marks-math.test.ts) deliberately keep fresh.
  const row = buildLegacyOptionMarkRow(
    "MRNA260904C00155000",
    { mark: 4.85, bid: 4.8, ask: 4.9, ts: NOW + 5 * 60_000 },
    null,
    NOW
  );
  assert.equal(row.mark, 4.85);
  assert.equal(row.stale, true);
});

test("buildLegacyOptionMarkRow: a WS bid=0 backstop quote wildly divergent from the last trade falls through to the last trade, not the fabricated mid (2026-09-15)", () => {
  // handleQuote (options-socket.ts) computes ws.mark via the SAME midOf(bp, ap) the REST snapshot
  // path used before the 2026-09-14 fix -- a bid:0/ask-only backstop quote arriving over the WS
  // feed produces the identical fabricated mid the REST fix above was written to catch, and since
  // ws?.mark was checked FIRST in the old `??` chain, it never even reached the REST-side guard.
  // Same CRSR-shaped repro: bid:0/ask:15 -> mid 7.5, real last trade 0.07 (107x divergence).
  const row = buildLegacyOptionMarkRow(
    "CRSR260918C00015000",
    { mark: 7.5, bid: 0, ask: 15, last: 0.07, ts: NOW },
    null,
    NOW
  );
  assert.equal(row.mark, 0.07, "must fall through to the real last trade, not the backstop mid");
});

test("buildLegacyOptionMarkRow: a WS real two-sided market (bid>0) is never second-guessed even with a large mid-vs-last divergence", () => {
  const row = buildLegacyOptionMarkRow(
    "MRNA260904C00155000",
    { mark: 7.5, bid: 5, ask: 10, last: 0.07, ts: NOW },
    null,
    NOW
  );
  assert.equal(row.mark, 7.5, "a real bid behind the WS quote must never be second-guessed against last-trade divergence");
});

test("buildLegacyOptionMarkRow: a WS bid=0 quote with no last trade at all passes the mid through unchanged (nothing to compare against)", () => {
  const row = buildLegacyOptionMarkRow(
    "MRNA260904C00155000",
    { mark: 7.5, bid: 0, ask: 15, last: null, ts: NOW },
    null,
    NOW
  );
  assert.equal(row.mark, 7.5);
});
