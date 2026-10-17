> **kind:** FINDING

## SPX news-risk keyword scorer had no negation/de-escalation awareness — FIXED

| **Status** | FIXED |
|---|---|
| **Severity** | P1 |
| **Area** | SPX Slayer confluence engine — `src/features/spx/lib/spx-signals.ts`, `scoreNewsRisk()` |
| **Found by** | Ask Largo × Night Hawk Swings standing mandate, post-merge verification cycle |

### Root cause

`scoreNewsRisk()` scans up to 10 desk news headlines for bare bear/bull macro-shock keywords
(`NEWS_BEAR_RE` — fed/fomc/halt/crash/war/sanctions/downgrade/..., `NEWS_BULL_RE` —
rate-cut/ceasefire/stimulus/deal/rally/...) and counts a hit whenever the keyword appears anywhere
in the headline. The scan had no awareness of negation or de-escalation language, so a headline
reporting the keyword's event being AVERTED, RESOLVED, or CALLED OFF scored identically to the
event actually happening:

- `"Stimulus deal collapses in Congress"` — matched the bull keywords "stimulus"/"deal" and scored
  as a positive headline, when the deal collapsing is the opposite of bullish news.
- `"Geopolitical tensions ease after ceasefire reached"` / `"War fears ease as ceasefire holds"` —
  matched the bear keywords "geopolit"/"war" alongside the correct bull hit "ceasefire", so a
  genuinely de-escalating headline double-counted as both a bear AND a bull hit, netting to a
  bearish factor instead of the bullish one it should have been.
- `"Market crash averted as central banks step in"` — matched the bear keyword "crash" and scored
  as a high-risk headline despite the crash explicitly NOT having occurred.

This factor feeds directly into the live SPX 0DTE confluence score (`computeSpxConfluence`), which
drives both the live intraday trading signal and the closed-session play-brief display — a
miscounted headline is not just a display defect, it can tip a live BUY_CALL/BUY_PUT/HOLD call.

### Fix

Added a bounded, word-window negation/de-escalation check (`buildNewsNegationCheck`) that suppresses
(never flips) a keyword hit when a reversal/resolution verb (avoided, averted, eases/eased/easing,
resolved, lifted, scrapped, cancelled, called off, shelved, subsided, dashed, collapsed, fell
through, de-escalated, ruled out, ...) appears within a bounded word-window immediately before or
after the keyword. Suppression rather than sentiment-flipping was the deliberate, conservative
choice — getting the direction wrong (scoring a collapsed deal as actively bearish) is worse than
the honest, pre-existing "omit when uncertain" discipline this codebase already applies elsewhere
(the Largo product contract's own absence/confidence principles).

The window excludes common clause-boundary words (and/but/as/while/after/before/though/...) from
being consumed as filler tokens, so a reversal verb belonging to one clause of a multi-clause
headline cannot spuriously cancel a genuinely separate keyword hit in a different clause — verified
by a dedicated test: `"Rate cut hopes dashed as Fed turns hawkish"` correctly cancels only the
rate-cut bull hit (the headline is net bearish, -4) rather than cancelling the real "Fed turns
hawkish" bear hit too.

### Evidence

4 new regression tests added, each confirmed RED (failing with the exact miscounted weight/sign)
against the unmodified source via `git stash` of the source fix alone, then GREEN restored:
- a reversal verb after the bear keyword correctly flips a would-be bearish double-count to a clean
  net-bullish read (+3, was: net-bearish -4 pre-fix)
- a bullish keyword followed by a collapse verb no longer scores bullish (was: +3, now: no factor)
- a reversal verb tied to one clause does not over-suppress a genuinely bearish keyword in a
  different clause of the same headline (stays -4, confirming cross-clause isolation works)
- an averted-crash headline no longer scores bearish (was: -4, now: no factor)

Full `spx-signals.test.ts` (11 tests) and `tsc --noEmit` both clean.

### Blast radius

Single call site — `scoreNewsRisk()` is the only implementation of this keyword scan; no duplicated
logic found elsewhere in the repo (`grep -r NEWS_BEAR_RE\|NEWS_BULL_RE\|scoreNewsRisk src` returns
only this file and its test).
