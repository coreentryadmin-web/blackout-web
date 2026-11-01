> **kind:** FINDING

## `/api/market/quote`'s de-duped-warning Set (`quoteFailureWarned`) had no size bound, unlike its sibling negative-cache Map — FIXED

**Status:** Fixed, regression test added (`src/app/api/market/quote/route.test.ts`).

### Root cause

`src/app/api/market/quote/route.ts` keeps two module-level, per-process structures to manage
REST quote failures:

- `quoteFailureMem: Map<string, number>` — the negative-result cache (recent-failure timestamp
  per ticker), explicitly bounded: `if (quoteFailureMem.size > 200) quoteFailureMem.clear();`
  inside `recordQuoteFailure`.
- `quoteFailureWarned: Set<string>` — tracks which tickers have already logged their
  once-per-outage `console.warn`, so a sustained vendor outage produces one warning per ticker
  instead of one per poll.

`quoteFailureWarned` had **no equivalent size bound**. Entries are added on a ticker's first
failure (`quoteFailureWarned.add(ticker)`) and removed ONLY on that same ticker's next success
(`quoteFailureWarned.delete(ticker)`, in `getRestQuote`'s success path). A ticker that never
recovers — or, more realistically, a sustained spread of distinct failing tickers (probing/bot
traffic hitting many invalid-but-nonexistent symbols that still pass the route's own
`^[A-Z0-9.-]{1,8}$` allowlist) — has no other exit path from the Set, so it grows for the
lifetime of the process with no eviction, unlike every sibling cache in this file
(`quoteMem`/`quoteFailureMem`, both explicitly cleared at `size > 200`).

The route's own comment on `quoteMem`'s bound states the general principle this Set violated:
*"Bound the in-memory map so an unusual spread of tickers can't grow it unbounded."*

### Evidence (RED → GREEN)

Added a regression test exercising the only externally-observable symptom of the unbounded
growth: a ticker that fails once (and is suppressed on an immediate repeat, per the existing
negative-cache window) should eventually be able to warn again once the Set has grown large
enough to clear — exactly as `quoteFailureMem` already does. Pre-fix, flooding the route with
201 distinct new failing tickers never cleared `quoteFailureWarned`, so a long-suppressed
sentinel ticker's warning stayed suppressed forever:

```
not ok 5 - quoteFailureWarned is bounded — a long spread of distinct failing tickers eventually re-arms a long-suppressed ticker's warning
  quoteFailureWarned must be bounded: once it clears, SENT1 can warn again instead of being suppressed forever by an ever-growing Set
  202 !== 203
```

Post-fix, same test: `5 pass / 0 fail` (`npx tsx --experimental-test-module-mocks --test
src/app/api/market/quote/route.test.ts`). All four pre-existing tests in the file still pass
unchanged. `tsc --noEmit` clean.

### Blast radius

Single call site (`recordQuoteFailure`), single consumer (`quoteFailureWarned`). No other file
imports or re-implements this pattern — checked `grep -rn "FailureWarned\|new Set()" src/app/api
src/lib` for the same unbounded-module-Set shape; nothing else recurred within scope for this
round (the broader repo-wide sweep for the same shape is a candidate for a future round).

### Fix rationale

Mirrored the exact bound already used one line above for `quoteFailureMem`: once
`quoteFailureWarned.size > 200`, clear the whole Set. This accepts the same tradeoff the
existing `quoteMem`/`quoteFailureMem` bounds already accept (an occasional early re-warn/re-fetch
after a clear) rather than introducing a different eviction policy (e.g. LRU) for just this one
structure — consistency with the sibling caches in the same file was preferred over a more
precise but inconsistent fix. Left the per-ticker success-path `delete` (line "quoteFailureWarned.delete(ticker)")
unchanged — that remains the primary, common-case cleanup path; the size bound is only a backstop
for the pathological case where a ticker never recovers or new distinct failing tickers keep
arriving.
