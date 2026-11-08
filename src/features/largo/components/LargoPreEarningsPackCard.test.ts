import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LargoPreEarningsPackCard } from "./LargoPreEarningsPackCard";
import type { PreEarningsPackCard } from "@/lib/largo/pre-earnings-pack";

(globalThis as unknown as { React: typeof React }).React = React;

/**
 * REGRESSION (round 422): this card had its own local `formatPrem(n)` that duplicated the
 * K/M-tier money formatter without the "round-first-then-promote" guard every other instance of
 * this formatter in the repo already carries (see fmt-money.ts's `fmtPremium`, helix-flow-format
 * .ts's `fmtOi`, darkpool-discord-format.ts's `fmtShares`, etc. — all patched for exactly this).
 * `card.flow.net_premium` is a live, unbounded dollar figure (pre-earnings-pack.ts's own
 * `net_premium: total >= 1 ? net : null`), so a ticker heading into earnings with ~$999,700 of
 * net premium hit the K branch (`abs >= 1_000_000` is false, `abs >= 1_000` is true), rounded to
 * a FOUR-DIGIT "1000K" instead of promoting to "1.0M" — the same class of bug already fixed
 * across the rest of the app. Fixed by deleting the duplicated local helper and reusing the
 * already-tested shared `fmtPremium` from `@/lib/fmt-money` (same remedy as PR #7588's
 * vector-play-candidates.ts fix), instead of hand-patching a third copy of the same guard.
 */

function baseCard(overrides: Partial<PreEarningsPackCard> = {}): PreEarningsPackCard {
  return {
    kind: "pre_earnings",
    ticker: "ACME",
    earnings_date: "2026-11-12",
    days_until: 4,
    report_time: "afterhours",
    is_confirmed: true,
    earnings_error: null,
    expected_move_pct: 6.2,
    positioning: {
      available: true,
      flip: 100,
      call_wall: 110,
      put_wall: 95,
      spot: 101,
      gamma_regime: "long gamma",
    },
    flow: {
      available: true,
      bias: "bullish",
      summary: "Calls bought into the print",
      net_premium: null,
    },
    history: [],
    history_summary: null,
    history_error: null,
    zerodte: null,
    as_of: "2026-11-08T14:00:00.000Z",
    as_of_session: "2026-11-08",
    as_of_weekday: "Sunday",
    ...overrides,
  };
}

const render = (card: PreEarningsPackCard) =>
  renderToStaticMarkup(React.createElement(LargoPreEarningsPackCard, { card }));

test("REGRESSION: net_premium just under $1M renders '$1.0M', never the overflowed '$1000K'", () => {
  const card = baseCard({ flow: { available: true, bias: "bullish", summary: "x", net_premium: 999_700 } });
  const html = render(card);

  assert.match(html, /\$1\.0M/, "a value that rounds to 1000K must promote to the next unit");
  assert.doesNotMatch(html, /1000K/, "the overflowed four-digit K label must never render");
});

test("net_premium comfortably inside the K tier still renders as K", () => {
  const card = baseCard({ flow: { available: true, bias: "bearish", summary: "x", net_premium: 456_700 } });
  const html = render(card);

  assert.match(html, /\$457K/);
});

test("net_premium comfortably inside the M tier renders as M", () => {
  const card = baseCard({ flow: { available: true, bias: "bullish", summary: "x", net_premium: 38_200_000 } });
  const html = render(card);

  assert.match(html, /\$38\.2M/);
});

/**
 * REGRESSION (2026-11-08, Ask Largo standing mandate): boardExposure() (pre-earnings-pack.ts)
 * used to never read the 0DTE board's own `upstream_ok` flag, so a degraded board
 * (buildMinimalBoardFallback(), upstream_ok:false, empty ledger/setups) and a genuinely clean
 * "not committed, not a setup candidate" board both rendered this exact same
 * {on_board:false, status:null, headline:null} shape here — "Not committed" with full
 * confidence either way. The fix adds `board_error` to `PreEarningsExposure`; this card must
 * render an honest "could not check" state when it's set, instead of the confident label.
 */
test("REGRESSION: a degraded 0DTE board (board_error set) renders an honest 'could not check' state, never 'Not committed'", () => {
  const card = baseCard({
    zerodte: {
      on_board: false,
      status: null,
      direction: null,
      pnl_pct: null,
      headline: null,
      board_error: "0DTE board unavailable this build — could not check",
    },
  });
  const html = render(card);

  assert.match(html, /could not check/i);
  assert.doesNotMatch(
    html,
    /Not committed/,
    "a degraded board must never render the same confident label a genuine absence gets"
  );
});

test("a genuinely clean 0DTE absence (board_error null) still renders 'Not committed' — no regression", () => {
  const card = baseCard({
    zerodte: {
      on_board: false,
      status: null,
      direction: null,
      pnl_pct: null,
      headline: null,
      board_error: null,
    },
  });
  const html = render(card);

  assert.match(html, /Not committed/);
});

test("a real on-board hit still renders 'On the board' with its status/PnL — no regression", () => {
  const card = baseCard({
    zerodte: {
      on_board: true,
      status: "OPEN",
      direction: "long",
      pnl_pct: 12.5,
      headline: "long · OPEN",
      board_error: null,
    },
  });
  const html = render(card);

  assert.match(html, /On the board/);
  assert.match(html, /OPEN/);
  assert.match(html, /12\.5%/);
});
