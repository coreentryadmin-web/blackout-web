> **kind:** FINDING

# `GET /api/admin/swing/multi-truth-grade` silently fails ~95% of retraces to a self-inflicted 429 burst

| | |
|---|---|
| **Status** | FIXED |
| **Area** | Swing 5-truth grader retrace — `src/app/api/admin/swing/multi-truth-grade/route.ts`, `src/lib/swing/grade-retrace.ts` |
| **Severity** | P3 — admin-only, read-only diagnostic endpoint; no member-facing or live-trading-path impact |

## Root cause

The route batches forward-underlying-bar fetches 10 concurrent distinct-ticker calls at a time
(`BAR_FETCH_BATCH_SIZE = 10`, no inter-batch delay) and swallows any failure with a bare
`.catch(() => [])`:

```ts
cached = fetchStockDailyBars(ticker, from, to).catch(() => []);
```

Live-reproduced directly: replaying this route's own 21 real `(ticker, from, to)` tuples through
the real `fetchStockDailyBars` at the same batch-of-10 concurrency, with NO other load, is enough
on its own to trip 5+ consecutive Polygon 429s and open `polygon-rate-limiter.ts`'s shared circuit
breaker (`"[polygon] Circuit opened after 5 consecutive 429s — pausing 60s"`). Every bar window
has real, fetchable Polygon daily data — confirmed directly: `MSTR 2026-11-03..06` returns 4 real
bars with no batching involved, and a direct `curl` against Polygon for the same range returns the
identical 4 bars.

Because the failure is swallowed to an empty array, it is byte-for-byte indistinguishable from
Polygon genuinely having no bars for that window — `multiTruthGrade.path.reason: "no_forward_bars"`
then reads as a confident absence claim when the real cause was a self-inflicted rate-limit trip.
This is exactly the absence-honesty violation `LARGO-PRODUCT-CONTRACT.md` exists to prevent (never
present a fetch failure as "no data"), just on an admin diagnostic surface rather than a
member-facing one.

## Evidence (RED → GREEN)

**RED** — three fresh, independent real calls to `GET /api/admin/swing/multi-truth-grade?days=90`
(production), each returning the same result: **3/64 (4.7%) PATH-gradeable**. The repo's own
existing audit script, `scripts/audit/swing-multi-truth-grade-retrace.mjs`, independently confirmed
the identical number on the same window — not a one-off fluke of my own probing.

Direct root-cause reproduction (bypassing the route, calling the real `fetchStockDailyBars` at the
route's own batch-of-10 concurrency against the same 21 real tuples):
```
[polygon] Circuit opened after 5 consecutive 429s — pausing 60s
{"t":"MSTR",...,"bars":4}
{"t":"GOOG",...,"error":"... → 429 (rate limited)"}
{"t":"MRNA",...,"error":"... → 429 (rate limited)"}
... (6/10 in the first batch alone failed with 429/circuit-open)
```

Direct confirmation the underlying data is real and fetchable (no batching, no concurrency):
```
MSTR 2026-11-03..2026-11-06 → 4 real daily bars (o/h/l/c/v), status OK
```

**GREEN** (post-fix): `npx tsx --experimental-test-module-mocks --test src/lib/swing/grade-retrace.test.ts`
— 11/11 pass (2 new tests for `barFetchErrorMessage`). `npx tsc --noEmit` clean. Full `npm test`
run clean (see PR for the run).

## Blast radius

Single route, single consumer: `GET /api/admin/swing/multi-truth-grade` and its one audit-script
caller, `scripts/audit/swing-multi-truth-grade-retrace.mjs` (also fixed in this PR to surface the
new `barsFetchError` field distinctly in its own summary, so a future run can't misread a 429 storm
as "95% of positions have no data"). No member-facing route, no schema change, no other caller
exists (grep-confirmed before this fix: this route and its audit script are the only two call
sites of `gradeSwingPosition`/`swingRowToGradeInput` outside their own tests).

## Fix rationale

Two independent, additive changes, both inside the admin-only diagnostic surface:

1. **Honest failure disclosure** (the correctness fix): `fetchStockDailyBars(...).catch(() => [])`
   → `.then(bars => ({bars, fetchError: null})).catch(error => ({bars: [], fetchError: barFetchErrorMessage(error)}))`.
   The new `barFetchErrorMessage` helper (`grade-retrace.ts`, pure, unit-tested) is the smallest
   extractable piece of this fix — everything else is route-level fetch orchestration, consistent
   with this file's own architecture doctrine ("row shaping is a pure, unit-tested mapper; the
   route only fetches and serializes"). Each result row now carries `barsFetchError: string | null`
   alongside the existing `barsFetched` count, non-null ONLY on a genuine fetch failure.
2. **Lower burst pressure** (the mitigation, not a guaranteed fix on its own): `BAR_FETCH_BATCH_SIZE`
   10 → 4, plus a new 400ms pause between batches where none existed before. This is a strictly
   more conservative change than the status quo — it cannot make 429 pressure worse — but it is not
   a hard guarantee against ever tripping the breaker under heavy contention (confirmed by a second
   local repro at the new batch size, which still tripped after accumulating prior test-session
   Polygon usage). The real fix for (1) stands on its own regardless of how (2) tunes out over
   time: a caller of this diagnostic route should never again read a rate-limit failure as a
   confident "no data" absence claim.

Deliberately NOT touched: `polygon-rate-limiter.ts`'s shared `GLOBAL_MAX_RPS`/`MAX_CONCURRENCY`
config (a cross-engine, production-wide tuning decision — changing it to accommodate one
rarely-used admin diagnostic route would be scope creep, not a fix), and `gradeSwingPosition`'s own
pure grading logic (correctly reports `no_forward_bars` given zero bars — the bug was entirely in
what the route fed it, not in how it graded what it got).
