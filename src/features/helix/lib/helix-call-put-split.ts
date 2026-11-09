/**
 * Call/Put premium % split — shared "never fabricate a complement" guard.
 *
 * BUG THIS FIXES (TickerDrawer.tsx's Call Premium / Put Premium summary boxes). `option_type` on
 * `FlowAlert` is a bare `string`, not a `"CALL" | "PUT"` union — an UNKNOWN/typeless/malformed
 * print is a real, live-reachable case (gap-#6, the same discipline already applied in
 * `FlowFeed.tsx`, `NetPremiumLeaderboard.tsx`, `HelixContextHeader.tsx`,
 * `helix-tape-analytics.ts`, `flow-strike-stacks.ts` and `bie/flow-brief.ts`). A typeless print
 * counts toward NEITHER `callPrem` nor `putPrem`, so a drawer whose visible flows are entirely
 * typeless (a real, non-rare tape shape — SPX/SPY carry most index premium with no readable
 * side) has `callPrem === 0 && putPrem === 0 && total === 0`.
 *
 * The drawer's own `callPct` was `total > 0 ? Math.round(...) : null` — correctly `null` on that
 * tape — but the Put Premium box rendered `100 - (callPct ?? 0)`, i.e. `100 - 0 = 100`. A $0 Put
 * Premium figure sat beside a bolded "100% of flow" caption, immediately beside a Call Premium
 * box reading "$0 · 0% of flow" for the exact same tape — the two captions summed to 100% while
 * both dollar figures were zero, fabricating a put-only tape out of data that measured nothing on
 * either side. The component's own header pill one screen-width away already refuses this exact
 * complement (`callPct == null ? "—" : ...`) — the premium boxes just never got the same guard.
 *
 * Extracted to a pure module (same split as every other "component has no render harness" fix
 * in this repo) so the split math — and the refusal to fabricate a complement when there is
 * nothing to split — is unit-tested directly.
 */

export type CallPutSplitPct = {
  /** Call's share of (call + put) premium, 0-100. `null` when there is no call/put premium to
   *  split at all — never a fabricated even/zero split. */
  callPct: number | null;
  /** `100 - callPct`. Derived by subtraction from the SAME total `callPct` was computed over, so
   *  the two can never independently read "measured" while describing a tape with no real split —
   *  `putPct` is `null` exactly when `callPct` is `null`, never a stand-alone complement. */
  putPct: number | null;
};

export function callPutSplitPct(callPremium: number, putPremium: number): CallPutSplitPct {
  const total = callPremium + putPremium;
  if (!(total > 0)) return { callPct: null, putPct: null };
  const callPct = Math.round((callPremium / total) * 100);
  return { callPct, putPct: 100 - callPct };
}

/** `null` renders as an honest em-dash — "not measured" must never look like "measured zero". */
export function fmtSplitPct(pct: number | null): string {
  return pct == null ? "—" : `${pct}%`;
}
