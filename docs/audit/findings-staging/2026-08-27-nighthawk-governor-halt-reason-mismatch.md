> **kind:** `FINDING`

## Night Hawk board shows the wrong halt reason when the AUDIT SEV-3 loss-halt fires — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Component** | `ZeroDteBoard.tsx` (`GovernorStrip`) |
| **Severity** | P2 — misleading operator/member-facing information, no data-integrity impact |

### Discovery context

Found live, mid-session, in response to the direct question "why don't we have open plays on
0DTE?" while running the standing market-hours monitoring pass. `zerodte-e2e-healthcheck.mjs`
reported `governor HALTED (2 stop(s), -9.7% session P&L)`. 2 hard stops is below the 3-stop halt
cap and -9.7% is nowhere near the -120% session-loss floor, so on those two numbers alone the halt
looked unexplained. Fetching the live `/api/market/zerodte/board` payload directly resolved it:
`realized_losers: 5` (exactly the `loss_halt_count` cap) with `would_halt` stating the real reason
— 5 of the day's 11 closed rows were realized losers (any exit reason, not just -50% hard stops),
tripping the AUDIT SEV-3 realized-loss halt channel (`src/lib/zerodte/governor.ts`), a channel
that's *additive* to and *independent from* the hard-stop channel the summary line quotes.

**The governor's decision to halt is correct and working as designed** — this is not a bug in risk
management. The bug is that the live Night Hawk board was showing members/operators the WRONG
explanation for it.

### Root cause

`GovernorStrip` in `ZeroDteBoard.tsx` hardcoded the halted banner to the hard-stop wording:

```tsx
{gov.halted && (
  <p ...>
    Session halted — {gov.stops.length} stops (max {gov.max_session_stops}). No new commits for
    the rest of the session.
  </p>
)}
```

But `gov.halted` (`ZeroDteGovernorSummary.halted`, `src/lib/zerodte/governor.ts:738-740`) is true
when EITHER the hard-stop channel fires (`stops.length >= max_session_stops`) OR the AUDIT SEV-3
realized-loss channel fires (`realized_losers >= loss_halt_count` OR `session_pnl_pct <=
session_loss_floor_pct`) — two independent, additive halt conditions with two different messages.
The server already computes and sends the correct explanation as `would_halt`
(`governorLossHaltReason`, `governor.ts:491-508`) — a complete sentence naming which condition
fired and the actual numbers behind it. The client's `BoardGovernor` type never declared
`would_halt`, `realized_losers`, `session_pnl_pct`, `loss_halt_count`, or `session_loss_floor_pct`
at all (confirmed live: the actual JSON response already carries all five; only the client's type
and the JSX were behind), so the component fell back to reconstructing a caption from the two
fields it did know about — the hard-stop count — regardless of which channel actually fired.

Live consequence measured today: the board displayed "Session halted — 2 stops (max 3)" — which
reads as "we're NOT at the stop cap yet, so why is this halted?" — while the actual, correct
explanation ("5 realized losers today (max 5)...") sat unused in the same API response.

### Fix

1. Added the five AUDIT SEV-3 fields to the client `BoardGovernor` type, mirroring
   `ZeroDteGovernorSummary` exactly (all optional, so an older/stale payload shape still
   type-checks).
2. Changed the halted banner to render `gov.would_halt` directly when present — it's already a
   complete, self-terminating sentence (ends in "...no new commits for the rest of the session.
   7/13's bleed came the same way, uncapped (AUDIT SEV-3).") — falling back to the original
   hard-stop sentence only when `would_halt` is absent (older payload shape) or null (the halt
   really is the hard-stop channel, in which case the original wording is correct and unchanged).

### Blast radius

Single component, single banner. The separate "Stops X/Y" pill (`GovPill label="Stops"`,
`ZeroDteBoard.tsx:504-513`) is unaffected and correct as-is — it reports the actual stop count,
never claims to be *the* halt reason. No server-side change needed; the correct data was already
being sent, just not read.

### Test

Added a source-invariant guard test to the existing `ZeroDteBoard.test.ts` (no React render
harness in this repo, matching that file's own precedent of testing exported pure functions)
asserting the halted-banner JSX prefers `gov.would_halt` over the hard-stop wording.
