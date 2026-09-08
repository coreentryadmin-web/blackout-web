# checkPortfolioOverlap's self-match exclusion silently swallowed genuine same-ticker/same-direction double positions

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | HIGH |
| **Area** | Swing portfolio-risk / Ask Largo `bookContextSection` / swing entry gate soft penalty |
| **Files** | `src/lib/swing/portfolio.ts`, `src/lib/swing/portfolio.test.ts` |
| **Source** | `docs/audit/SWING-SYSTEM-CTO-AUDIT-2026-09-06.md` finding #10 |

## Context

Independent verification of audit finding #10 ("checkPortfolioOverlap's self-match exclusion hides
genuine same-ticker+same-direction double positions from Ask Largo's concentration report").
Re-read `checkPortfolioOverlap` line-by-line against current `main` (post #4084/#4101/#4110/#4116)
rather than trusting the audit's description — the bug is real and was still live.

## Root cause

`checkPortfolioOverlap` (`portfolio.ts`) looped every row in `existing` and, for each row sharing
the candidate's ticker+direction, `continue`d — i.e. it excluded **every** matching row, not just
the ONE meant to represent "the candidate's own identical position":

```ts
for (const pos of existing) {
  // Skip the candidate's own identical position (same ticker + same direction).
  if (pos.ticker.trim().toUpperCase() === candTicker && pos.direction === candidate.direction) continue;
  ...
}
```

But `commit.ts`'s own design (its idempotency key is `swingThesisKey(ticker, direction, archetype)`,
commit.ts:316, with the header comment at commit.ts:310-313 stating outright "a different
archetype on the same name+side is a different thesis") explicitly permits **multiple independent
open positions on the same ticker + same direction** to coexist, as long as they carry a different
archetype. `PortfolioPosition` carries no identity field (just `{ticker, direction}`), so when TWO
independent same-ticker/same-direction rows are both present in `existing`, the loop's ticker+
direction match fires on BOTH and drops BOTH — not just the one standing in for "self." The single
most extreme concentration scenario this subsystem exists to catch (two open bets on the same name
in the same direction) was exactly the one case guaranteed to be invisible to it.

Live evidence cited in the audit (still valid against `main`): `record.json`'s 60-day track record
shows EWZ with two SEPARATE root position chains (rootPositionId 29 & 26, both direction `long`)
and WULF likewise (rootPositionId 17 & 13, both `long`) — this book has genuinely re-entered the
same name/side more than once, the exact shape the old exclusion logic could not see through.

## Why this wasn't caught earlier

`portfolio.test.ts`'s only same-ticker test (pre-fix) checked a single-row book against itself
(`checkPortfolioOverlap(long("NVDA"), [long("NVDA")])`) and never exercised the case of TWO
independent rows sharing ticker+direction — the exact input shape where "skip the match" silently
becomes "skip every match."

## Fix

Changed the self-match exclusion from "skip every row matching ticker+direction" to "skip only the
FIRST such row" (`selfExcluded` flag, set once). Every ADDITIONAL row sharing ticker+direction now
falls through to the normal `sameThesis` check and is correctly counted in
`sameThemeSameDirection`.

This is the minimal fix from the audit's own "at minimum" suggestion (give the caller no worse
behavior when there is truly only one matching row — that case is unchanged — while surfacing N-1
of N matching rows as genuine concentration instead of 0). It requires no schema/identity field on
`PortfolioPosition` and no changes to any caller.

## Blast radius

Two callers of `checkPortfolioOverlap`, both re-checked:
- `src/lib/swing/play-brief-intel.ts`'s `bookContextSection` (the one finding #10 named) — the
  play under review is always itself part of the `openBook` scanned (per `play-brief-context.ts`'s
  own comment), so exactly one row is the true self-match; this fix now correctly reports any
  OTHER same-ticker/same-direction row as concentration. `play-brief.test.ts`/
  `play-brief-intel.test.ts` re-run clean (37/37).
- `src/lib/swing/legacy-calibration/gates-pr5.ts`'s soft-penalty check (`portfolio_overlap`,
  evidence-only, not previously named in finding #10 but sharing the same root cause) — here the
  candidate is an UNCOMMITTED dossier with no representation in `ctx.existingPositions` at all, so
  the old "skip every match" behavior could also mask a real pre-existing same-ticker/same-
  direction position when exactly one existed. Under the fix, this call site still (correctly)
  treats the FIRST matching row as if it were "self" and skips it — this is a pre-existing,
  narrower gap at this specific call site (a not-yet-committed candidate has no genuine self-row
  to exclude at all) that this fix does not fully close, since doing so would require threading a
  position identity through the gate's `existingPositions` input, a larger change than finding #10
  scoped. Flagging for a follow-up rather than expanding this PR's blast radius.
  `gates-pr5.test.ts` re-run clean.

## Evidence (RED → GREEN)

New tests in `portfolio.test.ts`:
- `"a second, independent same-ticker/same-direction position is NOT swallowed by self-match
  exclusion"` — `checkPortfolioOverlap(long("EWZ"), [long("EWZ"), long("EWZ")])`.
- `"three independent same-ticker/same-direction positions: one self-match excluded, two counted"`.

`git stash push -- src/lib/swing/portfolio.ts` (tests kept), re-ran `portfolio.test.ts`:
**RED** — 5/7 pass, 2 fail (exactly the two new tests; both asserted `hasOverlap === true` and got
`false`). `git stash pop` restored the fix, re-ran: **GREEN** — 7/7 pass.

Full swing suite (`node --experimental-test-module-mocks --import tsx --test
src/lib/swing/**/*.test.ts`), `npx tsc --noEmit`, and the affected suites
(`play-brief.test.ts`, `play-brief-intel.test.ts`, `gates-pr5.test.ts`) all clean on Node 20
(v20.20.2). Full `npm test` run in progress at write time.

## Fix rationale — what was deliberately left unchanged

- Did not add an identity field (`id`) to `PortfolioPosition` or thread a position id through
  `TerminalPlay`/`loadOpenBook`/the gate's `existingPositions` — the audit's own "at minimum" fix
  (exclude only one match, count the rest) fully resolves the described bug for the play-brief
  caller (which is guaranteed to have exactly one true self-row) without that larger, cross-file
  change. The narrower residual gap at the gate call site (noted above) is real but pre-existing
  and out of scope for this fix.
- Did not change `commit.ts`'s idempotency design (`swingThesisKey`) — that design is correct and
  intentional; this fix makes `checkPortfolioOverlap` consistent with it, not the reverse.
