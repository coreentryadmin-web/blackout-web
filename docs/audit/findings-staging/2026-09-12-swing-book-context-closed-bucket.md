# Ask Largo "Book context" rendered a pending-entry-decision framing on an already-CLOSED trade

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (quality/trust — no wrong numbers, but a narrative that reads as live guidance about a decision that no longer exists, confusing a member reviewing trade history) |
| **Area** | Ask Largo — Swing play-brief (`src/lib/swing/play-brief-intel.ts::bookContextSection`) |
| **Found by** | Standing Ask Largo × Night Hawk Swings ownership mandate — 2026-09-12 live coordinator cycle, spot-checking a live CLOSED play-brief for gaps beyond what CLAUDE.md's Ask Largo section already lists |

## Root cause

`bookContextSection` compares the play's ticker/direction against `ctx.openBook` (the
member's CURRENT live book) and, on overlap, renders copy written for a PENDING entry
decision: `"Concentration — already holding N same-direction position(s) in theme
'{theme}': {names}. Adding {ticker} stacks the same wager rather than diversifying
risk."` It is called unconditionally for every bucket — WATCH, OPEN, and CLOSED alike —
with no bucket gate, unlike several sibling sections in the same file
(`vectorDeskSection` already takes a `bucket` parameter for exactly this reason).

For a CLOSED position there is no entry decision left to make: the trade already
happened and already resolved. If the CURRENT book happens to hold the same
ticker/theme (a plausible, unrelated re-entry after the close), the section still fires
with present/future-tense "Adding X stacks the same wager" language, which reads as live
guidance about an action the member is about to take — when in fact nothing about this
brief is actionable, and the overlap being reported has nothing to do with the trade
under review.

## Evidence

Live `GET /api/market/swing/play-brief?playId=SWING:AAPL:36&ticker=AAPL&positionId=36&status=CLOSED`
(2026-09-12) — a real closed AAPL position (entered 2026-09-03, stopped out -56.19% on
2026-09-04) — rendered:

```
### Book context
**Concentration** — already holding 1 same-direction position in theme "megatech": AAPL LONG.
Adding AAPL stacks the same wager rather than diversifying risk.
```

The "1 same-direction position" is the member's CURRENT live AAPL long (positionId 37,
entered 2026-09-11, a full week AFTER the closed trade being reviewed exited) — an
unrelated re-entry, not anything about the closed trade. A member reading this closed
brief would reasonably read it as "you're about to add AAPL risk, don't" — a decision
that isn't on the table anywhere in a CLOSED-bucket brief.

## Blast radius

- `bookContextSection` is the only call site rendering this copy (checked: no other
  consumer of `checkPortfolioOverlap`'s output uses this present-tense framing).
- Every other section already handling the CLOSED bucket correctly (`archetypeTrackRecordSection`
  for historical archetype context, `lessonsSection`/`Since it closed` for retrospective
  framing) is untouched — CLOSED already has a legitimate "how did trades like this do"
  retrospective; it just doesn't need a second, differently-framed "book overlap"
  section that implies a live decision.

## Fix

`bookContextSection` now returns `null` immediately for `play.status === "CLOSED"`,
before even checking the book for overlap — gated out entirely rather than reworded
past-tense, because "book overlap at review time" is a fact about the CURRENT book, not
about the closed trade being reviewed, so it doesn't belong on this bucket's brief at
all regardless of phrasing.

## Evidence (before/after)

- RED before fix (git-stashed the source fix, kept only the new test):
  `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-intel.test.ts`
  → `bookContextSection: null for a CLOSED play even when the current book overlaps`
  fails (a section is returned instead of `null`).
- GREEN after fix: same command, 92/92 pass (full file).
- Full suite: `npm test` (Node 20) — 13783 pass / 0 fail / 3 skipped (pre-existing,
  unrelated).
- `npx tsc --noEmit`: clean.

## Market-open validation

Logged in `docs/audit/MARKET-OPEN-VALIDATION.md` — during the next RTH session, pull
`GET /api/market/swing/play-brief` for any CLOSED position whose ticker/theme overlaps
the member's current live book, and confirm "Book context" no longer renders on that
brief (WATCH/OPEN briefs with a genuine overlap should still show it — this only guards
CLOSED).
