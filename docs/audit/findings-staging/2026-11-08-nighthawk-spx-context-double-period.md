> **kind:** FINDING

# Night Hawk Legacy recap double-periods when SPX data is fully unavailable

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Legacy overnight-edition recap — `src/features/nighthawk/lib/format.ts`'s `spxContext()` / `buildMarketRecap()` |
| **Severity** | P3 — member/Largo-facing text artifact, no data/calculation impact |

## Root cause

`spxContext()`'s fully-unavailable branch self-punctuated its own return string:

```ts
if (!spx) return "SPX data unavailable.";
```

`buildMarketRecap()`'s summary template unconditionally appends ANOTHER period when
concatenating that string:

```ts
const summary = `${tide}. ${spx}.${ctx.spx_gap ? ` ${formatSpxGapContext(ctx.spx_gap)}.` : ""}...`;
```

So whenever `ctx.spx_bars` has no last bar AND no `spxDesk` fallback is available,
`recap_summary` served a double period: `"...SPX data unavailable.. Macro: ..."`.

This exact bug CLASS already happened once before in this same file, for the sibling
`tideSummary()` function a few lines above `spxContext()` — that earlier fix (regression test
"recap summary never double-periods when tide is unavailable", entry already folded into
`docs/audit/FINDINGS.md`) deliberately rewrote `tideSummary()` to never self-punctuate its own
unavailable-case strings, specifically so `buildMarketRecap()` owns all the punctuation (see that
function's own inline comment: "No trailing period on any branch — callers own sentence-ending
punctuation"). That convention was never applied to `spxContext()`'s own fully-unavailable branch,
which kept violating it.

`spxContext()`'s other two return branches were checked and do **not** self-punctuate — neither
ends with a bare `.`:
- The `spxDesk` fallback branch (`spx_bars` empty but a live desk snapshot exists) ends with
  `... VIX ${...} (?)`.
- The real-bars branch ends with `... VIX ${...} (${vixChg...}%)`.

So only the one branch named above needed the fix; nothing else in this function shared the root
cause.

Why it wasn't caught earlier: `format.test.ts`'s shared `baseCtx()` helper always supplies a
non-empty `spx_bars` array, so every existing test exercised only the `spxDesk`-fallback or
real-bars branches of `spxContext()` — the fully-unavailable branch's punctuation had zero test
coverage before this fix.

## Evidence (RED → GREEN)

`src/features/nighthawk/lib/format.test.ts`, new test `"recap summary never double-periods when
SPX data is fully unavailable (no bars, no desk fallback)"` (constructs a context with
`spx_bars: []`, `vix_bars: []`, and no `spxDesk` argument to `buildMarketRecap`):

**RED** (pre-fix source, confirmed live by running the suite before editing `format.ts`):
```
not ok - recap summary never double-periods when SPX data is fully unavailable (no bars, no desk fallback)
  Expected values to be strictly equal:
  + actual - expected
  + 'SPX data unavailable.'
  - 'SPX data unavailable'
# tests 15
# pass 14
# fail 1
```

**GREEN** (post-fix, `spxContext()`'s unavailable branch returns `"SPX data unavailable"` with no
trailing period):
```
# tests 15
# pass 15
# fail 0
```

Run: `npx tsx --experimental-test-module-mocks --test src/features/nighthawk/lib/format.test.ts`
(Node 20). `npx tsc --noEmit` clean.

## Blast radius

`spxContext()` is not exported — its only caller is `buildMarketRecap()` in the same file, and
`buildMarketRecap()`'s `summary`/`spx_vix` fields are the only places this string reaches. From
there, `recap_summary` (and the standalone `spx_vix` field) flow verbatim through
`edition-builder.ts` into the persisted edition row and out through:
- `GET /api/market/nighthawk/edition` — the member-facing recap text.
- `src/lib/largo/nighthawk-edition-for-model.ts` — forwards `edition.recap_summary` unchanged
  (confirmed by reading the file: `recap_summary: edition.recap_summary ?? null`, no
  re-formatting), so Largo's tool-use answers about the overnight edition read the same double
  period. No separate change was needed there — the fix at the source flows through automatically
  once `spxContext()` stops self-punctuating.

No other call site constructs this string independently (verified via repo-wide grep for
`spxContext(` — the only call is inside `buildMarketRecap()`).

## Fix rationale

Mirror the exact convention `tideSummary()` already established in this same file rather than
inventing a new one: strip the branch's own trailing period and let `buildMarketRecap()`'s
template own all punctuation, consistent with every other branch in `spxContext()` that already
follows this rule. Deliberately left the `spxDesk`-fallback branch and the real-bars branch
untouched (and the unrelated spxDesk-threading fix from PR #7498) — both already follow the
no-self-punctuation convention, so touching them would have been scope creep on an otherwise
single-line, single-root-cause fix.
