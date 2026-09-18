## Ask Largo swing brief's CLOSED "Lessons" section never disclosed the position's own worst intra-trade drawdown, despite the identical trough data already used for the OPEN-bucket equivalent

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo swing play-brief — `closedCoaching` (`src/lib/swing/play-brief-narrative-coaching.ts`) |
| **Severity** | P3 (member-facing narrative quality / Largo product-contract historical-context point) |
| **Status** | FIXED — `fix/swing-closed-drawdown-coaching` |

### Root cause

`play.trough` (`TerminalPlay.trough`, the position's own worst intra-trade excursion) is computed
unconditionally in `adapters.ts` for every row with entry+trough premium — both the OPEN/WATCH path
(`terminalPlayFromHorizon`, `troughDisplay`) and the CLOSED path (`terminalPlayFromClosedSwing`).
But it never reached any section of a CLOSED Ask Largo brief: `closedSection` (`play-brief.ts`)
only renders Exit P&L / Reason / MFE capture / Closed date, and `closedCoaching`
(`play-brief-narrative-coaching.ts`, the real "Lessons" narrative for CLOSED positions) only ever
cited `play.peak` — never `play.trough` — anywhere in its logic.

The gap was self-camouflaging: the sibling `troughResilienceCoaching` function (OPEN bucket, built
2026-09-15) carried its own doc comment explicitly claiming *"a CLOSED play's own 'Lessons' section
already covers post-mortem framing for that bucket, and this isn't meant to duplicate it"* — a claim
that was never actually true. Anyone reading that comment (including a prior audit pass) would
reasonably conclude CLOSED was already handled.

### Evidence

`pnlSection`'s own 2026-09-15 comment (`play-brief.ts`, OPEN bucket) already articulates the exact
trader value of this data — "this one tested you early, don't flinch on the next drawdown scare" —
reasoning that applies with even more force in a post-mortem review (did this position round-trip
through a real drawdown before it worked, or before it failed for good — a pattern worth noting for
the next similar setup). Confirmed by direct read of `closedCoaching`'s full body: every line
pushed cites `play.peak`, `play.exitPnlPct`, or `play.closedReason` — `play.trough` never appears.

### Blast radius

Single call site (`closedCoaching`'s CLOSED-bucket "Lessons" content). Also corrected the false
claim in `troughResilienceCoaching`'s own doc comment, which is documentation-only (no behavior
change to the OPEN-bucket function itself).

### Fix rationale

Added a `**Drawdown before outcome**` line to `closedCoaching`, gated identically to
`troughResilienceCoaching`'s existing threshold (`trough < 0` AND `peak - trough >= 40` points) for
consistency — never fires on a shallow or non-negative excursion, preserving honest absence when
the position never traded meaningfully negative.

### Verification

- Independent RED→GREEN (reverted only the source file, kept the tests):
  `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-narrative-coaching.test.ts`
  — 1/106 failed with source reverted, exactly the new assertion. Reapplied — 106/106 pass.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief*.test.ts` — 591/591 pass.
- `npx tsc --noEmit` — clean.
- Full `npm test` (Node 20) — 14623/14626 pass, 0 fail, 3 pre-existing skips (a first run showed 1 unrelated flake with no reproducing detail captured; an immediate full re-run on the same commit came back 100% clean, matching CI's own green `verify` check on the same SHA).
