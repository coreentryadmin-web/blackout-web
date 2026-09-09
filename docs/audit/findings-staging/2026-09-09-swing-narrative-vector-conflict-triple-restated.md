> **kind:** FINDING

## Ask Largo swing brief — the same Vector-vs-swing conflict was restated as three separate facts in one document — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Ask Largo swing play-brief narrative composition (`src/lib/swing/play-brief-narrative.ts`, `src/lib/swing/play-brief-narrative-coaching.ts`) |
| **Severity** | P3 (narrative quality — not a wrong number, but the "trade manager voice, not a bullet dump" mandate this repo holds Ask Largo to) |

### Root cause

Three independently-composed narrative functions each derive the SAME Vector-vs-swing-direction
misalignment from the SAME `vec.play.bias` / `play.direction` inputs, with zero cross-awareness of
each other:

- `crossDeskCoaching` (`play-brief-narrative-coaching.ts`) — fires a `**Cross-desk friction**`
  bullet naming the conflict and the Vector headline.
- `vectorPlayCoaching` (same file) — independently re-derives the identical `aligned` boolean and,
  when misaligned, appends a `— **cross-check** Vector thesis vs swing direction.` clause quoting
  the SAME headline.
- `counterThesisLine` (`play-brief-narrative.ts`) — independently re-derives the same misalignment
  a third time and pushes a `Vector bearish/bullish (<headline>)` reason into its counter-thesis
  list.

**Live repro (NRG brief, 2026-09-09, standing Ask Largo deep-dive cycle):** all three fired for the
same live position (Vector: `POSITION · momentum short on continuation → target 1σ 114.19`, swing
LONG). The rendered "Trade manager read" section carried:
```
• **Cross-desk friction** — Vector bearish (POSITION · momentum short on continuation → target 1σ 114.19). Size down until desks agree.
• Vector desk: **POSITION · momentum short on continuation → target 1σ 114.19** · invalidation **5m close > 121.84** — **cross-check** Vector thesis vs swing direction.
...
• **Counter-thesis (bear case)** — Vector bearish (POSITION · momentum short on continuation → target 1σ 114.19) · bear EMA stack on chart · fading pillar **Persistence**.
```
The identical fact — Vector disagrees with this swing's direction — appears three times across
three sections of one document. This is exactly the "narrative section reads like a bullet dump
instead of a trade manager" anti-pattern the standing Ask Largo ownership mandate calls out: a real
trade manager states a disagreement once and moves on, not three times in different words.

The existing per-bullet dedup in `tradeManagerNarrativeSection`'s `add()` helper (a 48-char-prefix
`seen` set) does not catch this — each of the three sentences has a different prefix, so it reads
as three distinct facts, not a literal duplicate.

### Fix

Threaded a boolean through the composition pipeline rather than restructuring the three functions'
independent evidence-reading logic (each function's OTHER content stays valid and non-duplicative):

- `collectCoachingBullets` computes `crossDeskCoaching`'s result first, checks whether it already
  named a Vector conflict (`/Vector (bearish|bullish)/`), and passes that as a new
  `conflictAlreadyNoted` parameter into `vectorPlayCoaching`. When set, `vectorPlayCoaching` still
  renders its own non-duplicative content (headline, invalidation, starred level) — only the
  redundant `— cross-check Vector thesis vs swing direction.` framing clause is dropped.
- `tradeManagerNarrativeSection` checks the already-accumulated `bullets` array for the same
  pattern before calling `counterThesisLine`, and passes a `vectorConflictAlreadyNoted` flag that
  makes `counterThesisLine` skip ONLY its Vector-specific reason — the function's other
  counter-thesis reasons (bear EMA stack, GEX walls, fading pillar) are independent evidence and
  are untouched.

Both suppressions are conditioned on the SAME `aligned`/misalignment check each function already
computed for its own purposes — no new coupling to internal state, just an added flag threaded
through existing pure-function boundaries.

### Evidence

- New regression test `vectorPlayCoaching: omits the redundant cross-check clause when the
  conflict was already noted elsewhere, but keeps the headline/invalidation` (
  `play-brief-narrative-coaching.test.ts`).
- New integration test `collectCoachingBullets: crossDeskCoaching's Vector-conflict bullet
  suppresses vectorPlayCoaching's redundant cross-check clause` — proves exactly one
  `Cross-desk friction` bullet and exactly one `Vector desk:` bullet, with the latter's headline
  preserved but its `cross-check` clause absent.
- New integration test `tradeManagerNarrativeSection: Counter-thesis omits the Vector reason when
  crossDeskCoaching already named it, but keeps other reasons` — proves exactly one `Cross-desk
  friction` and exactly one `Counter-thesis` bullet, the latter missing `Vector bearish` but still
  carrying the independent `bear EMA stack` reason (proving this is not a blanket suppression).
- Full `src/lib/swing/*.test.ts` suite: 844/844 pass, 0 fail.
- `npx tsc --noEmit`: clean.
- RED→GREEN proven via `git stash` (source-only revert): 3 test failures pre-fix, 0 post-fix.

### Blast radius

Two files, three call sites (`vectorPlayCoaching`'s call inside `collectCoachingBullets`,
`counterThesisLine`'s call inside `tradeManagerNarrativeSection`). Grepped both files for any other
independently-derived Vector-misalignment check — none found; `technicalsCoaching`'s bull/bear vote
reads chart evidence (EMA/MACD/VWAP), not `vec.play.bias`, and is a genuinely separate signal, not
a fourth restatement of the same fact.
