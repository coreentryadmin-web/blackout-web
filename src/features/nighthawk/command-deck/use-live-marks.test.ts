import { test } from "node:test";
import assert from "node:assert/strict";
import {
  overlayLiveMarks,
  marksMapFromPayload,
  restFallbackShouldPoll,
  type LiveMarkRow,
} from "./use-live-marks.ts";
import type { TerminalPlay } from "./types.ts";

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
