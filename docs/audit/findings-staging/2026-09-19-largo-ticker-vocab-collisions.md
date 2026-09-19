# Largo ticker extractor: 5 more everyday trading words silently resolve to unrelated tickers

> **kind:** FINDING

## Summary

Found while auditing `question-intent.ts`'s `STOPWORD_TICKERS` list for other instances of the same
collision class the same-day `SPOT` fix (PR #5245, `fix/largo-spot-ticker-collision`) closed. Five
more real symbols in `KNOWN_TICKERS` are also everyday trading words, and none of them were guarded:
**SNAP, COIN, SHOP, PLUG, META**. Any member question using the ordinary idiom — "snap back rally,"
"coin flip," "shop around for an entry," "plug in the numbers," "pretty meta" — silently pinned
Largo's `tickerHint` to Snap Inc / Coinbase / Shopify / Plug Power / Meta Platforms instead of
answering the tickerless question the member actually asked, routing tool calls and the reply to an
unrelated instrument's live feed with no indication anything went wrong.

## Root cause

`extractTicker` (`src/lib/largo/question-intent.ts`) matches candidates off `question.toUpperCase()`
(`qUpper`), so case information is discarded before matching — the ONLY thing that restores it is an
explicit `STOPWORD_TICKERS` membership check (`!writtenUppercase(question, cand)`), which runs before
the `KNOWN_TICKERS` fast-path. A `KNOWN_TICKERS` member that is NOT also in `STOPWORD_TICKERS` is
therefore returned regardless of how the member actually wrote it — lowercase idiom or genuine shout,
identically. This is the exact mechanism the file's own `NOW`/`SPOT` comments already document; it
was simply never swept for other members of `KNOWN_TICKERS` that double as ordinary words.

## Evidence

Live `analyzeLargoQuestion()` calls, reproduced on `main` (pre-fix) via `npx tsx`:

```
"wait for a snap back rally here"                    -> tickerHint "SNAP"
"is this trade just a coin flip at this point"        -> tickerHint "COIN"
"should I shop around for a better entry"             -> tickerHint "SHOP"
"let's plug in the numbers here"                      -> tickerHint "PLUG"
"that seems pretty meta to me"                        -> tickerHint "META"
```

None of these five questions name a ticker. Each one would have driven Largo to answer using an
unrelated stock's live feed (spot/walls/flow/etc.) instead of the member's actual, tickerless
question — the same defect shape as the `NOW`/ServiceNow regression (2026-08-10) and the `SPOT`
regression found the same day as this finding.

## Blast radius

Only `question-intent.ts`'s single `STOPWORD_TICKERS` set — there is exactly one extractor in the
codebase per that file's own header comment ("EXPORTED so there is exactly ONE answer to this
question in the codebase"), so no other call site needed touching.

## Fix

Added `"SNAP", "COIN", "SHOP", "PLUG", "META"` to `STOPWORD_TICKERS`, with an in-code comment
documenting the exact repro strings so a future sweep doesn't have to re-derive them. Each symbol
still resolves correctly when genuinely shouted or `$`-prefixed (added to the regression test):
`"what's the setup on SNAP"` -> `SNAP`, `"what's the setup on $COIN"` -> `COIN`.

**Deliberately did NOT add `SPOT`** — that entry belongs to the separately-tracked, already-open
`fix/largo-spot-ticker-collision` (#5245), to avoid two PRs racing the same line for the same fix.

## Test

`src/lib/largo/question-intent.test.ts` — new test `"ordinary trading idioms that collide with a
real symbol are not tickers unless shouted"`. RED confirmed pre-fix (`git stash` the source change,
re-run): fails on the first case (`SNAP`) with `tickerHint === 'SNAP'` instead of `null`. GREEN
post-fix, full file 36/36 passing. `npx tsc --noEmit -p .` clean.

| **Status** | FIXED |
|---|---|
