> **kind:** FINDING

## Night Hawk Legacy: `buildLegacyOptionMarkRow` served a raw, unguarded backstop `ask` while `mark` was correctly guarded — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** standing production-correctness audit, cross-checking `src/features/nighthawk/lib/legacy-option-mark-row.ts`
against the already-shipped `reliableAskFromSnapshot`/`reliableMarkFromSnapshot` guards in
`src/lib/providers/options-snapshot.ts`.

**Root cause:** `buildLegacyOptionMarkRow` computes `mark` via `reliableMarkFromQuote(ws.mark,...)`
(WS branch) and `reliableMarkFromSnapshot(snap)` (REST branch) — both of which correctly fall
through to the contract's real last-traded price when `bid === 0` and the quoted `ask` is a
market-maker "backstop" quote diverging more than 10x (or 3x for a thin one-lot ask) from that
reference price. That guard was built and shipped 2026-09-14/15 after the live CRSR
(260918C00015000) incident: `bid:0, ask:15` against a real last trade of `$0.07` — a 107x
divergence that would otherwise fabricate a `$7.50` mid.

But the row's own `bid`/`ask` **fields** — the ones returned to callers alongside `mark` — were set
directly from the raw provider values with no equivalent check:

```ts
const bid = ws?.bid ?? snap?.bid ?? null;
const ask = ws?.ask ?? snap?.ask ?? null;   // <- raw, unguarded, even when mark (same row) is guarded
```

So a backstop ask was served as-is in the row's `ask` field even on a row whose `mark` had already
been correctly corrected away from it on the very same call. The sibling file
`src/lib/providers/options-snapshot.ts` already ships `reliableAskFromSnapshot` for exactly this
failure mode (built 2026-10-24 after it was found live on Night Hawk Swings' play-brief Spread
line — CRI precedent) and it is already wired into `swing-active-refresh`'s and
`banger-live-sync`'s cron fetchers, but it was never extended to `legacy-option-mark-row.ts`,
which is shared by both `GET /api/market/nighthawk/legacy-marks` (the route this audit explicitly
checks for "inside [bid,ask], no crossed book") and `legacy-option-marks-server.ts`'s
`fetchLegacyOptionMarksServer` (feeds the `legacy-live-sync` cron and
`legacy-discord-trade-notify`).

**Evidence (live incident shape, CRSR 260918C00015000):** for both a REST-snapshot source and a
WS-tick source, input `{bid:0, ask:15, last:0.07}` produced output `{mark:0.07, bid:0, ask:15,
stale:false}` pre-fix — `mark` correctly corrected to `$0.07`, but `ask` still raw at `15`, an
implied spread `(ask-bid)/mark` of 21,428.6% served with no staleness/unreliability flag.
Reproduced directly against the real exported `buildLegacyOptionMarkRow` function (not a mock).

**Fix:** extracted a new generic `reliableAskFromQuote(ask, bid, mark, reference, askSize)` in
`options-snapshot.ts` (the ask-side sibling of the existing generic `reliableMarkFromQuote`), and
refactored `reliableAskFromSnapshot` to delegate to it — behavior-preserving (verified against the
full existing `reliableAskFromSnapshot` test suite, all still pass unchanged) — so a caller with a
non-`OptionSnapshot` quote shape (the Legacy WS mark stream's `{mark, bid, ask, last}`, which
carries no `dayClose`/`askSize`) can apply the identical divergence guard without constructing a
fake snapshot object. `buildLegacyOptionMarkRow` now guards both branches: `reliableAskFromQuote`
for the WS tick (mirroring the existing `wsMark` computation, same reference price `ws.last`), and
`reliableAskFromSnapshot` for the REST snapshot (mirroring `snapMark`). `bid` is intentionally left
unguarded — it is never the fabricated side of a backstop quote; the guard only ever engages when
`bid === 0`, which is already the true, un-fabricated bid.

**Fix rationale — why this and not an alternative:** reusing the existing, already-tested
divergence math (rather than reimplementing a third copy) keeps the WS, REST, and
Legacy-specific-row guards from drifting apart, matching this repo's established pattern (`mark`'s
own guard already delegates `reliableMarkFromSnapshot` → `reliableMarkFromQuote`). A nulled-out
backstop ask (rather than substituting the reference price) matches `reliableAskFromSnapshot`'s own
existing contract — the ask is a quoted price, not a valuation, so when it cannot be trusted there
is no honest "ask" to report, only an honest absence.

**Evidence (RED → GREEN):** added 4 test cases to
`src/features/nighthawk/lib/legacy-option-mark-row.test.ts` — 2 reproducing the live CRSR shape on
both the REST and WS branches (ask must not equal the raw backstop `15`; must be `null`), 2
confirming the guard's existing exemptions still hold (a real two-sided market `bid>0` is never
second-guessed; a legitimate deep-OTM `bid=0` ask within the divergence bar keeps its real value).
RED (reverted the fix on `legacy-option-mark-row.ts`/`options-snapshot.ts` only, kept the new
tests): 2/15 failing, both asserting `row.ask !== 15` — confirming the bug reproduces on the
pre-fix code on both branches. GREEN (post-fix): `npx tsx --experimental-test-module-mocks --test
legacy-option-mark-row.test.ts` → 15/15 pass. Full blast-radius sweep (every consumer of either
touched file — `legacy-option-mark-row.test.ts`, `options-snapshot.test.ts`,
`options-snapshot-freshness.test.ts`, `PlayTerminal.ssr.test.ts`, `option-chain-prompt.test.ts`,
`swing-active-refresh`/`banger-live-sync` route tests, `zerodte/live-marks`/`exit-sync`/`scan`
tests, `banger/quote-tick-log`, `ws/options-socket-*-merge`, `swing/play-brief`,
`swing/contract-ranker`): 453/453 pass, 0 fail. `npx tsc --noEmit`: clean. `npx eslint` on all
touched files: clean.

**Blast radius:** both callers of `buildLegacyOptionMarkRow` get the fix automatically — the
publicly-polled `GET /api/market/nighthawk/legacy-marks` route and
`legacy-option-marks-server.ts`'s `fetchLegacyOptionMarksServer` (feeds `legacy-live-sync` and
`legacy-discord-trade-notify`). Client-side impact today: of Legacy's consumers, only `row.bid`
(not `row.ask`) is currently read (`use-legacy-option-marks.ts`'s `overlayLegacyOptionMarks`,
feeding `execMark`/`execPnlPct` in `legacy-primary-pnl.ts`); no current Legacy UI component renders
`row.ask` directly, and `legacy-live-sync`'s cron only reads `row.mark` — so this fix closes a
contract-level defect in the publicly polled JSON response (any present or future consumer reading
`row.ask` would have been corrupted), not a currently-rendered member-facing number. The
`reliableAskFromQuote` extraction is purely additive — `reliableAskFromSnapshot`'s existing
behavior and test suite are unchanged (verified).
