# swing-allocation.ts's own comments claim the book-percent caps are advisory-only — they are a live commit gate today

> **kind:** FINDING

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (documentation correctness, capital-risk-relevant) |
| **Lane** | Night Hawk Swings |
| **Found by** | Ask Largo × Night Hawk Swings standing mandate (2026-09-22) |

## Root cause

`swing-allocation.ts`'s own header and several field-level doc comments say, repeatedly and
unambiguously: `capFlags` are "advisory (enforce:false) — nothing is applied", `advisorySizing`
is "a suggestion only, never applied", and the whole module's caps only "start sizing/blocking
real risk once the portfolio backtest graduates them (PR-16)". A returned runtime string
(`reasons[]`) even told a caller a breached cap was "not applied".

None of this is true of the actual live path. `commit.ts`'s `computeSwingCommitPlan` (called from
`discovery.ts`, the real discovery/commit cron path) calls `allocateSwingBook` as its "Gate 2" with
the real, "operator-confirmed" `DEFAULT_SWING_CAPS` (5%/20%/40%/3), reads
`decision.capFlags[].wouldBreach` for the returned decision, and pushes every breach onto
`blockedBy`. `blockedBy.length === 0` is a hard prerequisite for `committable`; a candidate that
isn't committable never gets a real `SwingPositionInsert` — at best it gets a zero-capital SHADOW
row. `commit.ts`'s own header independently and correctly says the caps are "real-time risk
controls, unchanged and unweakened" — `swing-allocation.ts`'s header directly contradicted its own
consumer.

`allocateSwingBook` itself genuinely never resizes or blocks anything — it's a pure annotator, and
`advisorySizing` genuinely is never read by any caller (confirmed by grep — only `capFlags` is
consulted). So the file wasn't simply wrong, it conflated two different things: "this function
doesn't act on its own output" (true) with "nothing downstream acts on it either" (false, and the
false half is the one a future reader would actually rely on when reasoning about whether these
caps protect real capital).

## Why this matters

A future session (or a fold/audit pass) reading only this file's own comments would reasonably
conclude the book-percent caps are inert scaffolding waiting on a "PR-16" that may never have
existed as described, and could propose relaxing/removing them as "dead code" or fail to flag a
regression that silently disabled Gate 2 — because the file itself says nothing would change.

## Fix

Corrected the header block and every misleading field doc (`wouldBreach`, `capFlags`,
`proposedPct`, `enforce`, `advisorySizing`) to state precisely what's true: this module never
mutates or blocks on its own, but `commit.ts`'s Gate 2 already treats a `capFlags[].wouldBreach`
as a live block, today, with the real default caps. Also fixed the runtime `reasons[]` string that
claimed a breach was "not applied" — for the exact case that string is emitted, it was about to be.
Documentation/data-only change — no logic, no exported behavior touched.

## Evidence

`npx tsc --noEmit`: clean. `swing-allocation.test.ts`: 10/10 pass. `commit.test.ts`: 44/44 pass.
Full `src/lib/swing/*.test.ts`: 1503/1503 pass — confirms zero behavior change, as expected for a
comment/string-only correction.

## Blast radius

One file. No caller reads the corrected comments programmatically; the one corrected runtime
string (`reasons[]`) has no test asserting its exact text (confirmed by grep) and is evidence/log
content, not a member-facing surface.
