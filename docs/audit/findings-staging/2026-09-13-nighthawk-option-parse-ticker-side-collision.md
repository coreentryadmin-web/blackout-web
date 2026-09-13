> **kind:** FINDING

# Night Hawk options-contract side parser could misread a PUT as a CALL for ticker "C"

| | |
|---|---|
| **Status** | FIXED |
| **Surface** | `parseOptionsContract` (`src/features/nighthawk/lib/option-contract-parse.ts`) — the shared pure parser reused by `grounding.ts`, `legacy-discord-trade-notify.ts`, `play-outcomes.ts`, `deterministic-edition.ts`, `legacy-play-contract.ts`, and `nighthawk-verifier.ts` |
| **Severity** | P2 — a real (if narrow) live-correctness risk: a misparsed side would ground/publish the wrong side's premium/OI, and could post the wrong long/short direction to the live Discord trade bot. Not observed to have shipped a wrong number yet — caught proactively, no live incident. |

## Root cause

The side-detection regex was a single combined alternation:

```ts
const sideMatch = text.match(/\b(CALL|PUT|C|P)\b/i);
```

A JS regex without the global flag returns the match at the **first position** where **any**
alternative succeeds — it tries alternatives in listed order only at that one position, it does
not keep scanning for a "better" (more specific) match later in the string. For a real
single-letter ticker like Citigroup ("C"), the bare `C` alternative matched the **ticker symbol
itself** (leftmost, position 0) before the engine ever reached the real `PUT` token appearing
later in the same string:

```js
"C $62 PUT @ $2.91 — Sep 25, entry prem ~$2.91".match(/\b(CALL|PUT|C|P)\b/i)
// -> "C"  (the ticker), not "PUT"
```

A CALL play on ticker C happened to parse correctly by coincidence (bare `C` already means
"call"), which is exactly why this went unnoticed — only a PUT play on a same-letter ticker was
affected.

## Blast radius

Checked every consumer of `parseOptionsContract` (`grep -rl` across `src/`):

- `grounding.ts`'s `groundPlay()` uses the parsed `side` to pick which half of the chain
  (`call_ask`/`call_oi` vs `put_ask`/`put_oi`) to validate against and to overwrite
  `entry_premium` with the live contract mark — a misparsed side would ground and publish the
  **wrong side's** premium/OI for what the human-readable `options_play` text still correctly
  called a PUT.
- `legacy-discord-trade-notify.ts`'s `legacyOptionDirection()` calls this parser first (falling
  back to `play.direction` only on a parse miss) — a live Discord BTO/STC alert for a Citigroup
  PUT play could have posted the wrong long/short direction to the Chief Trade Alert Bot.
- `play-outcomes.ts`, `deterministic-edition.ts`, `legacy-play-contract.ts`, and
  `nighthawk-verifier.ts` all consume the same parser; none needed changes since the fix is
  internal to the parser and the return shape is unchanged.

## Fix

Try an unambiguous full-word match before ever falling back to the bare single-letter
abbreviation:

```ts
const sideMatch = text.match(/\b(CALL|PUT)\b/i) ?? text.match(/\b(C|P)\b/i);
```

An explicit `PUT`/`CALL` token anywhere in the string now always wins over a same-letter ticker
symbol. The bare-abbreviation fallback (needed for Claude-generated freeform text using
`"$12 C"`/`"$12 P"` shorthand) is unchanged for every ticker that isn't itself literally `C` or
`P`.

## Why this fix, not an alternative

Considered making the parser ticker-aware (skip the leading ticker token entirely before
searching for a side match) — rejected as more invasive for no extra benefit: the two-step
full-word-then-abbreviation match fixes every case where the ambiguity is actually resolvable
(an explicit "PUT"/"CALL" word present anywhere), which is also the only format production
actually ships (see Evidence). A residual edge case (ticker literally "C"/"P" combined with the
*abbreviated* `"C $62 P @ ..."` shorthand) is not solved by either approach without hard-coding
ticker awareness, and is far rarer than the full-word case this fix closes.

## Evidence

- Live-verified production always uses full `"CALL"`/`"PUT"` words in the deterministic template
  (`deterministic-edition.ts`'s own docstring: `"AAPL $120 CALL @ $4.00 — Jul 18"`), confirming
  the fix's fast path covers the real shipped format.
- No dedicated test file existed for this parser at all (`option-contract-parse.ts` had zero test
  coverage repo-wide) — added `option-contract-parse.test.ts` (7 tests) covering the normal
  CALL/PUT cases, the ticker-C collision, the bare-abbreviation fallback with a non-colliding
  ticker, and ISO expiry extraction.
- RED: reverted `option-contract-parse.ts` only (kept the new test file), 1/7 new tests failed
  (the ticker-C-with-PUT case, exactly as predicted).
- GREEN: restored the fix, 7/7 pass.
- `npx tsc --noEmit`: clean.
- Full suite (Node 20): 14020 pass / 0 fail / 3 skipped.

## What was deliberately left unchanged

The strike/expiry parsing branches (not implicated — ticker collisions only affect the C/P side
alternation) and every call site (all consume the parser's return value unchanged; no signature
change).
