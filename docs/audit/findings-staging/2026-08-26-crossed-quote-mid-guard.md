> **kind:** `FINDING`

## Three `midOf`/`zeroDteMidOf` copies fabricated a mid on a crossed book — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** `zeroDteMidOf` (`src/lib/zerodte/marks-math.ts`) computed `(bid+ask)/2` from
any `bid >= 0, ask > 0` pair with no check that `ask >= bid`. A transient crossed print (a stale
bid update lagging a fast-moving thin 0DTE book, plausible near expiry on illiquid OTM contracts)
would synthesize a fabricated "mid" instead of being rejected. This lane runs continuously on
already-committed plays and feeds: `pinnedLivePnlPct` (member-facing live P&L), `advancePlayLatch`
(the PERSISTED peak/trough that decides TRIM/CLOSED transitions), and `engineMark` (the real-time
ratchet/thesis-break exit engine's own input). The pre-commit gate
(`plan.ts`'s `evaluateQuoteValidity`) already refuses a crossed quote outright as `"crossed"` —
this live-lane function had no equivalent guard.

**Blast radius — same bug, two more copies.** `zeroDteMidOf`'s own doc comment says "IDENTICAL
guard to the chain/WS midOf", and grep confirmed two more hand-duplicated copies sharing the
identical gap: `options-snapshot.ts`'s `midOf` and `ws/options-socket.ts`'s `midOf`. Two
*independently*-written sibling implementations elsewhere in the codebase
(`horizon-fanout.ts`'s `midOf`, `execution/slippage.ts`'s `midOf`) already required `ask >= bid` —
confirming this was an oversight in the three explicitly-synced copies, not a deliberate scope
decision. `zeroDteMidOf`'s own sibling in the same file, `zeroDteHalfSpreadFrac`, also already
rejected a crossed book — the asymmetry was isolated to the mid computation itself.

**Fix.** Added `ask >= bid` to all three synced copies (`zeroDteMidOf`, `options-snapshot.ts`'s
`midOf`, `options-socket.ts`'s `midOf`), preserving the "must stay identical" invariant the code
comments already declare between them. A locked book (`ask == bid`) is still a valid quote and
returns that price, matching `zeroDteHalfSpreadFrac`'s own locked-book handling (returns `0`, not
`null`).

**Also fixed alongside (same review pass): a one-minute clock mismatch.**
`terminal-ladder.ts`'s `timeStopClock().past_time_stop` used `nowEtMinutes >= stop`, while
`derivePlayStatus` (`plan.ts`) and every grader use strict `>` against the same
`time_stop_et_minutes` constant (950 = 15:50 ET) — `plan.test.ts` explicitly pins the boundary
minute itself as still-in-window ("inclusive"). So the displayed "TIME STOP" UI flag lit up a
full minute before the play's actual lifecycle/grading boundary. Cosmetic only (nothing here
grades a play), but a real, previously-undocumented inconsistency between the displayed clock and
the mechanism it describes. Changed to strict `>` to match.

**Regression tests.**
- `marks-math.test.ts`: "zeroDteMidOf: a CROSSED book (ask < bid) must return null, not a
  fabricated midpoint" — confirmed failing pre-fix (`zeroDteMidOf(1.2, 1.0)` returned `1.1`
  instead of `null`), passing post-fix.
- `terminal-ladder.test.ts`: "clock: past_time_stop matches derivePlayStatus's own boundary — AT
  the stop minute is NOT past it" — confirmed failing pre-fix (`past_time_stop` was `true` at the
  exact stop minute), passing post-fix.

**Deliberately unchanged.** Did not add direct tests for the two sibling `midOf` copies
(`options-snapshot.ts`, `options-socket.ts`) — both are private, unexported helpers with no
existing test coverage of their own; the shared logic is now pinned by `zeroDteMidOf`'s test, and
exporting two private helpers purely to duplicate that same test was judged disproportionate
scope for this fix.
