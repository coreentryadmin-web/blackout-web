> **kind:** FINDING

## SPX Slayer: `BEAR_NEWS`/`BULL_NEWS` keyword match with no adjacent negation/reversal check — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** five-engine-largo-cycle-59 live production audit (2026-11-01), per the standing
5-engine live monitor mandate, cross-checked against the live SPX Slayer desk payload.

**Root cause:** `src/features/spx/lib/spx-play-conflicts.ts`'s `newsSentiment()` classified a
headline's sentiment purely by testing whether a `BEAR_NEWS`/`BULL_NEWS` keyword appears **anywhere**
in the title, with no check for an adjacent negating/reversal phrase. A headline whose keyword is
immediately reversed by the surrounding words ("X hits a wall", "X stalls", "X fades") was
misclassified as if the naive keyword polarity held — the regex has no notion of "this keyword's own
clause was just undone three words later."

**Live evidence:** real production headline, confirmed against the live desk payload: *"S&P 500
Index Rally Hits a Wall Amid AI Jitters as Key Valuation Metric Dips"*. Pre-fix:
`BULL_NEWS.test(title) === true` (matches `"rally"`), so `newsSentiment()` returned `"bullish"` for
the whole 5-headline batch — even though the headline's actual content ("Rally Hits a Wall... AI
Jitters... Valuation Metric Dips") is a stalling/cautionary read, not a confirming-rally one.

**Blast radius — two independent call sites, same root cause:**
1. `spx-play-conflicts.ts`'s own `newsOpposed()` (consumed by `computeWeightedConflicts()`) — a
   false "opposing bullish news" conflict could be added to `weighted_conflicts`, which feeds
   `evaluatePlayGates`'s mixed-tape hard block and entry-mode/size cap. Equally, a false-bullish
   read could mask a genuine stalling signal that *should* have opposed a short.
2. `src/features/spx/lib/spx-play-confirmations.ts` re-implements its own `newsSentiment()` for the
   "News catalyst" confirmation check, importing the **same** `BEAR_NEWS`/`BULL_NEWS` regexes from
   `spx-play-conflicts.ts` (per that file's own comment: "Canonical news-sentiment patterns live in
   spx-play-conflicts to avoid duplication") and testing them directly the same naive way. Both
   files shared the identical defect; fixing only one would have left the confirmation check
   misreading the same reversed headlines as confirming bullish/bearish evidence.

**Fix:** added a single shared chokepoint instead of patching either call site's loop individually.
`spx-play-conflicts.ts` now exports `matchesBullNews(title)` / `matchesBearNews(title)`, which wrap
`BULL_NEWS.test()`/`BEAR_NEWS.test()` with a new `isNegatedByReversal()` check: after the regex match
position, look within a short window (24 chars) for a reversal phrase (`hits? a wall`, `stalls?`,
`fades?`, `stumbles?`, `reverses?`, `loses? steam`, `runs? out of steam`, `peters? out`, `cools?`,
and their inflections). If a reversal phrase immediately follows the matched keyword, that match no
longer counts toward the keyword's naive polarity. `spx-play-conflicts.ts`'s own `newsSentiment()`
was switched to call `matchesBullNews`/`matchesBearNews` instead of testing `BULL_NEWS`/`BEAR_NEWS`
directly, and `spx-play-confirmations.ts` now imports and calls the same two functions instead of
re-testing the raw regexes — so both call sites are fixed at the one shared layer, not duplicated.

**Fix rationale:** scoped tightly to the real failure mode — a plain regex-based reversal-phrase
check immediately after the matched keyword, consistent with the file's existing regex style (no
NLP library, no rewrite of the whole sentiment engine). The window is bounded (24 chars) specifically
so an unrelated reversal phrase elsewhere in a longer headline cannot suppress a real, unrelated
signal — only a reversal that is genuinely adjacent to the matched keyword voids it.

**Evidence (RED → GREEN):** added 2 test cases to `src/features/spx/lib/spx-play-conflicts.test.ts`:
one using the exact live headline above (asserts `weighted_conflicts === 0` for a short direction,
i.e. no false "opposing bullish news" bonus), and one confirming the existing true-positive case
("Market rally continues on dovish Fed tone", no reversal phrase) still adds the +2 opposing-news
bonus — no regression. RED (source reverted to `origin/main` via `git show`): the new test failed
(`2 !== 0` — the reversed headline still triggered the false bullish-news conflict bonus) while the
true-positive test passed unchanged. GREEN (fix restored):
`npx tsx --experimental-test-module-mocks --test src/features/spx/lib/spx-play-conflicts.test.ts` →
7/7 pass. Also ran the sibling `spx-play-confirmations.test.ts` (6/6 pass, including its existing
"News catalyst" tests citing the matched headline) and the full `src/features/spx/lib/*.test.ts`
suite (918/918 pass) to confirm no regression in either call site or any other SPX Slayer logic.
`npx tsc --noEmit` on the full project: clean.
