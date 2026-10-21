## 2026-10-21 — [FINDING, P3 SPX Slayer] "News catalyst" confirmation always cited `news_headlines[0]` instead of the headline that actually matched the bull/bear verdict — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | SPX Slayer — `spx-play-confirmations.ts` |
| **PR** | (pending) |

### Symptom

`evaluatePlayConfirmations()`'s "News catalyst" check computes its bullish/bearish verdict with
`newsSentiment()`, which regex-tests each headline against `BULL_NEWS`/`BEAR_NEWS`
(`spx-play-conflicts.ts`). The verdict is correct, but the human-readable `detail` string quoted
to justify it was built from `desk.news_headlines?.[0]?.title` unconditionally — the raw feed's
first item, regardless of which headline(s), if any, actually tripped the regex. `news_headlines`
is not sorted by relevance to SPX, so the cited "evidence" is frequently a completely unrelated
single-stock note.

### Live repro (production `GET /api/market/spx/play`, 2026-10-21)

`confirmations.checks` included:

```json
{"label":"News catalyst","required":false,"passed":true,
 "detail":"News bullish · Oppenheimer Maintains Outperform on SPX Technologies, Lowers Price Target to $26"}
```

That headline is an SPXC (SPX Technologies — an unrelated single-stock ticker whose name merely
contains the literal substring "SPX") analyst note. It matches neither `BULL_NEWS` nor
`BEAR_NEWS` and has nothing to do with the S&P 500 index SPX Slayer trades. The headline that
actually matched (via the word "Soar" → `BULL_NEWS`) was `news_headlines[2]`, "Airline Stocks
Soar After United Airlines' Strong Guidance" — never shown to the trader reading the
confirmation.

### Root cause

`src/features/spx/lib/spx-play-confirmations.ts` (pre-fix, ~line 274):

```ts
const topHeadline = desk.news_headlines?.[0]?.title?.slice(0, 80) ?? "none";
```

`newsSentiment()` (same file) only ever returned the bare `"bullish" | "bearish" | "neutral"`
verdict — it computed which headlines matched internally but discarded that information, so the
caller had nothing to cite except the unconditional first array element.

### Fix

`newsSentiment()` now returns `{ sentiment, matched }`, where `matched` is the list of headline
objects that actually tripped `BULL_NEWS`/`BEAR_NEWS` on the winning side (both sides' matches in
a genuine bull==bear>0 tie, which still resolves to `"neutral"`). The "News catalyst" check now
builds its `topHeadline` from `news.matched[0]`, falling back to the literal string `"none"` only
when nothing matched at all — never silently substituting an unrelated headline as if it were
evidence. `newsSentiment()` is a local, unexported function used only at this one call site in
this file (the file's own leading comment notes the regex constants, not the sentiment function
itself, are shared with `spx-play-conflicts.ts`, which has its own separate `newsSentiment()` that
only ever consumed the bare verdict — not the detail-text, so it was not affected by this bug and
was left unchanged).

### Blast radius

Checked `spx-play-conflicts.ts`'s own `newsSentiment()`/`newsOpposed()` — it only reads the
sentiment verdict, never a headline-text quote, so it was never exposed to this bug and needed no
change. No other call site in the repo builds a "top headline" detail string from
`news_headlines[0]`.

### Evidence

Regression tests added to `src/features/spx/lib/spx-play-confirmations.test.ts` (`News catalyst:
...`, 3 new cases): the exact live repro (SPXC note first, matching "Soar" headline third) now
cites the matched headline and never the unrelated one; an opposing-direction (bearish) repro
cites the matched bearish headline, not headlines[0]; a no-match repro reports `"none"` instead of
an unrelated headline. RED→GREEN proven by isolating the fix to the source file only (test file
restored from fix, source file temporarily reverted to the pre-fix `origin/main` version): 3/6
tests failed pre-fix with the exact live-bug detail strings as the assertion failures, all 6 pass
post-fix. Full file run (Node 20, `npx tsx --experimental-test-module-mocks --test
src/features/spx/lib/spx-play-confirmations.test.ts`): 6/6 pass. Sibling files
(`spx-play-conflicts.test.ts`, `useStablePlayConfirmations.test.ts`, `spx-play-payload.test.ts`):
13/13 pass. `npx tsc --noEmit` on the whole project: clean, 0 errors.
