import { test } from "node:test";
import assert from "node:assert/strict";
import {
  overlayLiveMarks,
  overlayHorizonWatchTrack,
  overlayZeroDteStockQuotes,
  latchLiveExcursion,
  marksMapFromPayload,
  restFallbackShouldPoll,
  type LiveMarkRow,
} from "./use-live-marks.ts";
import {
  capQuoteTickers,
  ZERODTE_QUOTE_MAX_TICKERS,
  ZERODTE_QUOTE_POLL_MS,
} from "./use-zero-dte-live-deck.ts";
import type { TerminalPlay } from "./types.ts";
import type { TerminalExitLadder } from "@/lib/zerodte/terminal-ladder.ts";

function play(over: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "0DTE:NVDA",
    ticker: "NVDA",
    direction: "LONG",
    contract: "192C · 0DTE",
    occ: "NVDA260724C00192000",
    score: 88,
    status: "OPEN",
    horizon: "ZERO_DTE",
    exitModel: "RATCHET",
    factors: [],
    gates: [],
    recommendation: "HOLD",
    entry: 4.2,
    mark: 5.0,
    pnlPct: 19,
    greeks: null,
    ...over,
  };
}

function row(over: Partial<LiveMarkRow> = {}): LiveMarkRow {
  return {
    ticker: "NVDA",
    occ: "NVDA260724C00192000",
    mark: 6.9,
    live_pnl_pct: 64,
    stale: false,
    greeks: { delta: 0.55, gamma: 0.02, theta: -0.3, vega: 0.1, iv: 0.42 },
    ...over,
  };
}

test("overlayLiveMarks: freshest mark/P&L/greeks win, keyed by OCC", () => {
  const out = overlayLiveMarks([play()], new Map([[row().occ, row()]]));
  assert.equal(out[0]!.mark, 6.9); // board 5.0 → live 6.9
  assert.equal(out[0]!.pnlPct, 64); // board 19 → live 64
  assert.equal(out[0]!.greeks?.delta, 0.55); // board null → live greeks
});

test("overlayLiveMarks: empty lane is a no-op (returns board plays unchanged)", () => {
  const base = [play()];
  assert.equal(overlayLiveMarks(base, new Map()), base); // identity — pure enhancement
});

test("overlayLiveMarks: a play with no matching live row keeps its board values", () => {
  const other = new Map([["SPY260724C00500000", row({ occ: "SPY260724C00500000" })]]);
  const out = overlayLiveMarks([play()], other);
  assert.equal(out[0]!.mark, 5.0);
  assert.equal(out[0]!.pnlPct, 19);
  assert.equal(out[0]!.greeks, null);
});

test("overlayLiveMarks: null live fields fall back to the board value (never blank a known number)", () => {
  const out = overlayLiveMarks(
    [play()],
    new Map([[row().occ, row({ mark: null, live_pnl_pct: null, greeks: null })]]),
  );
  assert.equal(out[0]!.mark, 5.0); // fell back to board
  assert.equal(out[0]!.pnlPct, 19);
});

test("overlayLiveMarks: a play with no OCC is left untouched", () => {
  const out = overlayLiveMarks([play({ occ: null })], new Map([[row().occ, row()]]));
  assert.equal(out[0]!.mark, 5.0);
});

test("overlayLiveMarks: a STALE live row is NOT overlaid — the fresher board value wins", () => {
  // A stale SSE row still carries a (now-old) mark/pnl; overlaying it would replace the fresher board poll
  // with a stale number under a LIVE badge. Must keep board values.
  const out = overlayLiveMarks(
    [play()],
    new Map([[row().occ, row({ stale: true, mark: 9.9, live_pnl_pct: 135 })]]),
  );
  assert.equal(out[0]!.mark, 5.0); // board value kept, stale 9.9 ignored
  assert.equal(out[0]!.pnlPct, 19);
  assert.equal(out[0]!.greeks, null); // stale greeks not applied either
});

// ── REST-fallback wiring (SEV-3) — pure pieces the hook composes ──────────────────────
// The hook itself (EventSource + fetch + useEffect) can't unit-test under `tsx --test`
// (no DOM/EventSource), so its two decisions are extracted as pure functions and covered
// here: (1) the fallback activates ONLY while SSE is not OPEN, and (2) it feeds the SAME
// OCC-keyed map the SSE path feeds.

test("restFallbackShouldPoll: polls only while SSE is NOT open (CONNECTING/CLOSED), stands down when OPEN", () => {
  // EventSource.readyState — 0 CONNECTING · 1 OPEN · 2 CLOSED.
  assert.equal(restFallbackShouldPoll(0), true); // reconnect window → fallback carries
  assert.equal(restFallbackShouldPoll(1), false); // healthy stream → do NOT double-fetch
  assert.equal(restFallbackShouldPoll(2), true); // terminal CLOSED (no auto-retry) → fallback carries
});

test("marksMapFromPayload: SSE and REST payloads of the same rows build the IDENTICAL overlay map", () => {
  // Both lanes deliver the same server payload shape; the map must be structurally identical
  // whichever transport produced it (that is the whole point of one shared builder).
  const rows: LiveMarkRow[] = [row(), row({ occ: "SPY260724C00500000", ticker: "SPY", mark: 3.3 })];
  const fromSse = marksMapFromPayload({ available: true, marks: rows });
  const fromRest = marksMapFromPayload({ available: true, idle: false, marks: rows });
  assert.deepEqual([...fromRest!.entries()], [...fromSse!.entries()]);
  // And it drives overlayLiveMarks exactly as an SSE-built map would.
  const out = overlayLiveMarks([play()], fromRest!);
  assert.equal(out[0]!.mark, 6.9);
  assert.equal(out[0]!.pnlPct, 64);
});

test("marksMapFromPayload: empty / idle / malformed payload is a NO-OP (null → keep last good marks)", () => {
  // Mirrors the SSE handler's rows.length===0 skip so an idle poll between frames can't blank the terminal.
  assert.equal(marksMapFromPayload({ available: true, idle: true, marks: [] }), null);
  assert.equal(marksMapFromPayload({ available: false }), null);
  assert.equal(marksMapFromPayload({} as never), null);
});

test("marksMapFromPayload: a polled STALE row still routes through the >5s stale-drop (board value wins)", () => {
  // The fallback feeds the same map, so overlayLiveMarks applies the identical stale drop to a POLLED row.
  const map = marksMapFromPayload({
    available: true,
    marks: [row({ stale: true, mark: 9.9, live_pnl_pct: 135 })],
  });
  const out = overlayLiveMarks([play()], map!);
  assert.equal(out[0]!.mark, 5.0); // stale polled mark ignored, board value kept
  assert.equal(out[0]!.pnlPct, 19);
});

test("overlayLiveMarks: Terminal v2 — overlays executable fill, exec P&L, mark_as_of; marks a fresh frame not-sync", () => {
  const p = play({ execMark: null, execPnlPct: null, markAsOf: null, markIsSync: true });
  const marks = new Map<string, LiveMarkRow>([
    [p.occ!, row({ bid: 6.7, live_pnl_pct_exec: 59, mark_as_of: "2026-07-25T14:00:00.000Z" })],
  ]);
  const [out] = overlayLiveMarks([p], marks);
  assert.equal(out!.execMark, 6.7); // sells into the live bid
  assert.equal(out!.execPnlPct, 59);
  assert.equal(out!.markAsOf, "2026-07-25T14:00:00.000Z");
  assert.equal(out!.markIsSync, false); // a live SSE frame is never a legacy sync mark
});

test("overlayLiveMarks: a stale live row keeps board values (never overlays exec/age either)", () => {
  const p = play({ execMark: 1.11, markAsOf: "board-ts", markIsSync: true });
  const marks = new Map<string, LiveMarkRow>([
    [p.occ!, row({ stale: true, bid: 9.9, mark_as_of: "sse-ts" })],
  ]);
  const [out] = overlayLiveMarks([p], marks);
  assert.equal(out!.execMark, 1.11); // unchanged — stale row skipped
  assert.equal(out!.markAsOf, "board-ts");
  assert.equal(out!.markIsSync, true);
});

test("latchLiveExcursion: advances peak/trough from live pnl and arms trim FIRED (never un-fires)", () => {
  const ladder: TerminalExitLadder = {
    policy: "trim_scale",
    hard_stop_pct: -50,
    target_pct: 100,
    trim_levels: [
      { trigger_pct: 25, fraction: 0.333, premium: 5.25, fired: true }, // already banked
      { trigger_pct: 50, fraction: 0.333, premium: 6.3, fired: false },
    ],
    runner_fraction: 0.334,
    stop_premium: 2.1,
    target_premium: 8.4,
    time_stop_et: "15:30",
  };
  const out = latchLiveExcursion(play({ peak: 30, trough: -5, exitPolicy: ladder }), 55);
  assert.equal(out.peak, 55);
  assert.equal(out.trough, -5); // trough never rises
  assert.equal(out.exitPolicy!.trim_levels[0]!.fired, true); // stayed fired
  assert.equal(out.exitPolicy!.trim_levels[1]!.fired, true); // newly armed at +55 ≥ 50
});

test("overlayLiveMarks: fresh frame latches peak + arms trim from live pnl", () => {
  const ladder: TerminalExitLadder = {
    policy: "trim_scale",
    hard_stop_pct: -50,
    target_pct: 100,
    trim_levels: [{ trigger_pct: 25, fraction: 0.333, premium: 5.25, fired: false }],
    runner_fraction: 0.667,
    stop_premium: 2.1,
    target_premium: 8.4,
    time_stop_et: "15:30",
  };
  const [out] = overlayLiveMarks(
    [play({ peak: 10, trough: 0, exitPolicy: ladder, pnlPct: 10 })],
    new Map([[row().occ, row({ live_pnl_pct: 40 })]]),
  );
  assert.equal(out!.pnlPct, 40);
  assert.equal(out!.peak, 40);
  assert.equal(out!.exitPolicy!.trim_levels[0]!.fired, true);
});

test("overlayZeroDteStockQuotes: refreshes stockPrice (+ condor spot) from the quote poll", () => {
  const [out] = overlayZeroDteStockQuotes(
    [play({ stockPrice: 100, isCondor: true, condor: {
      spot: 100, spotIsLive: false, shortPut: 95, longPut: 90, shortCall: 105, longCall: 110,
      wingPts: 5, netCredit: 1.2, maxLoss: 3.8, breachLower: 95, breachUpper: 105, winRate: 80, breachRatePct: 20,
    } })],
    new Map([["NVDA", { price: 101.5, asof: "2026-07-28T15:00:00.000Z" }]]),
  );
  assert.equal(out!.stockPrice, 101.5);
  assert.equal(out!.condor!.spot, 101.5);
  assert.equal(out!.condor!.spotIsLive, true);
});

test("overlayLiveMarks: WATCH 0DTE updates trackPct from live mark, never pnlPct", () => {
  const [out] = overlayLiveMarks(
    [play({
      status: "WATCH",
      pnlPct: null,
      trackReferencePremium: 4.0,
      trackPct: 10,
      entry: null,
    })],
    new Map([[row().occ, row({ mark: 5.0, live_pnl_pct: 99 })]]),
  );
  assert.equal(out!.pnlPct, null);
  assert.equal(out!.trackPct, 25);
  assert.equal(out!.mark, 5.0);
});

test("overlayLiveMarks: SKIP 0DTE updates trackPct like WATCH", () => {
  const [out] = overlayLiveMarks(
    [play({
      status: "SKIP",
      pnlPct: null,
      trackReferencePremium: 18.0,
      trackPct: null,
      entry: null,
    })],
    new Map([[row().occ, row({ mark: 19.15, live_pnl_pct: 99 })]]),
  );
  assert.equal(out!.pnlPct, null);
  assert.equal(out!.trackPct, 6.39);
});

test("overlayHorizonWatchTrack: WATCH swing stamps underlying track from live quote", () => {
  const [out] = overlayHorizonWatchTrack(
    [{
      ...play({ horizon: "SWING", status: "WATCH", pnlPct: null, flagUnderlyingPx: 100 }),
    }],
    new Map([["NVDA", { price: 108 }]]),
  );
  assert.equal(out!.trackPct, 8);
  assert.equal(out!.stockPrice, 108);
});

// ---------------------------------------------------------------------------
// 0DTE underlying-quote fan-out bound (2026-08-06 prod saturation incident).
// The 0DTE deck drives useLegacyStockQuotes, which issues ONE
// /api/market/quote?ticker=X request PER TICKER PER TICK. Demanded request rate
// is therefore rowCount/pollMs, so BOTH the cap and the cadence are load-bearing
// and are asserted here as regression bounds.
// ---------------------------------------------------------------------------

test("capQuoteTickers: caps the 0DTE quote fan-out at the bulk-SSE ticker limit", () => {
  // A ~106-row board (what prod actually served during the incident) must not
  // produce a 106-wide per-tick fan-out.
  const plays = Array.from({ length: 106 }, (_, i) => ({ ticker: `T${i}`, status: "WATCH" }));
  const out = capQuoteTickers(plays, ZERODTE_QUOTE_MAX_TICKERS);
  assert.equal(out.length, 60);
  assert.equal(ZERODTE_QUOTE_MAX_TICKERS, 60, "must match the server's MAX_TICKERS_PER_STREAM");
});

test("capQuoteTickers: working rows (live capital) are never dropped by the cap", () => {
  // Ledger-only working rows carry NO underlying_price in the board payload, so
  // they have no board-cadence fallback price — they must win the cap.
  const plays = [
    ...Array.from({ length: 100 }, (_, i) => ({ ticker: `W${i}`, status: "WATCH" })),
    { ticker: "HELD", status: "HOLD" },
    { ticker: "OPENED", status: "OPEN" },
    { ticker: "TRIMMED", status: "TRIM" },
  ];
  const out = capQuoteTickers(plays, ZERODTE_QUOTE_MAX_TICKERS);
  assert.equal(out.length, 60);
  assert.deepEqual(out.slice(0, 3), ["HELD", "OPENED", "TRIMMED"]);
});

test("capQuoteTickers: dedupes and preserves board order under the cap", () => {
  const out = capQuoteTickers(
    [{ ticker: "AMD" }, { ticker: "NVDA" }, { ticker: "AMD" }, { ticker: "" }],
    60,
  );
  assert.deepEqual(out, ["AMD", "NVDA"]);
});

test("0DTE quote poll cadence keeps demanded request rate bounded", () => {
  // Regression bound on the incident arithmetic: 106 tickers @ 1s = ~106 req/s
  // per open tab against an uncacheable Clerk-authed route. Cap + cadence must
  // hold the worst case to single digits per second.
  const worstCaseReqPerSec = ZERODTE_QUOTE_MAX_TICKERS / (ZERODTE_QUOTE_POLL_MS / 1_000);
  assert.ok(
    worstCaseReqPerSec <= 10,
    `0DTE quote fan-out is ${worstCaseReqPerSec} req/s per tab — must stay <= 10`,
  );
});
