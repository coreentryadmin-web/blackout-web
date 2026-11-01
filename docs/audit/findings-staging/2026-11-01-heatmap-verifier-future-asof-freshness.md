> **kind:** FINDING

## Heat Maps correctness verifier's `freshnessCheck` can be fooled into a false "fresh" PASS by a future-dated `asof` — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** full read-through of `src/lib/correctness/heatmap-verifier.ts` (round 327 of the
standing audit sweep, following up on the "only the top was sampled previously" lead from round
326), cross-checked against the sibling fix already shipped for the identical bug shape in
`src/lib/correctness/data-integrity-verifier.ts`'s own `ageMin()` helper (2026-09-04).

**Root cause:** `freshnessCheck` (the LAYER 6 freshness check for the Heat Maps GEX/VEX/DEX/CHARM
matrix) computed the served matrix's age as a plain, unguarded subtraction:

```ts
const ageMin = (ctx.now - asofMs) / 60000;
...
const fresh = ageMin <= TOL.freshnessMin; // TOL.freshnessMin = 15
```

If `hm.asof` is **ahead of** `ctx.now` — ordinary clock skew between the ECS replica that wrote the
matrix (`heatmap-warm`) and the replica running this verifier, or a genuinely corrupted/miswritten
`asof` — `ageMin` goes negative, and a negative number always satisfies `ageMin <= 15`. The check
then reports the metric as `consistency-only` ("fresh"), exactly the verdict a correctly-fresh
matrix gets, instead of flagging the served timestamp as untrustworthy. This check's entire reason
to exist is to catch a stale/corrupted matrix being served as live — a future-dated `asof` silently
reading as "fresh" is a false PASS on precisely the failure shape the layer was built to detect.

This is the identical root cause `data-integrity-verifier.ts`'s own `ageMin()` helper already fixed
on 2026-09-04 (its doc comment: *"a `thenMs` more than ZERODTE_MARK_FUTURE_TOLERANCE_MS ahead of
`now`... used to produce a NEGATIVE age that trivially passed every `aMin <= threshold` freshness
check below... Returns Infinity for a too-far-future `thenMs`"*). `heatmap-verifier.ts` sits right
next to that file in the same `src/lib/correctness/` directory and verifies the same GEX matrix
`data-integrity-verifier.ts`'s Redis layer reads (`gex-heatmap:{ticker}`), but its own, separately
inlined age computation never inherited that fix — it is the one freshness check in this directory
still exposed to the bug.

**Evidence (RED → GREEN), `src/lib/correctness/heatmap-verifier.test.ts`:**

Added 5 tests exercising `freshnessCheck` directly (now exported for this purpose) against a
hand-built `GexHeatmap` fixture, covering: an ordinary past `asof` (fresh), a genuinely stale past
`asof` (flags — the pre-existing baseline), a small in-tolerance future skew (±10s, still fresh),
the bug reproduction (a 20-minute-future `asof`), and the off-RTH skip path.

Proved RED on the pre-fix logic by reverting *only* the `ageMin` computation line back to
`(ctx.now - asofMs) / 60000` (keeping the new export/tests):

```
npx tsx --experimental-test-module-mocks --test src/lib/correctness/heatmap-verifier.test.ts
```
→ `freshnessCheck: BUG FIX — an asof far in the future... FLAGS, not a false fresh PASS` **FAILED**
(`expected: 'flag'`, `actual: 'consistency-only'`) — 31/32 pass, 1 fail, reproducing the exact false
PASS described above.

Restored the fix → same command → **32/32 pass**.

**Fix:** guard the age computation with the same fail-closed sentinel `data-integrity-verifier.ts`
uses — reusing its tolerance constant (`ZERODTE_MARK_FUTURE_TOLERANCE_MS`, 60s) from the
dependency-free `src/lib/zerodte/marks-math.ts` leaf (zero imports of its own; already the single
source of truth for this exact tolerance, imported the same way by `data-integrity-verifier.ts`):

```ts
const diffMs = ctx.now - asofMs;
const ageMin = diffMs < -ZERODTE_MARK_FUTURE_TOLERANCE_MS ? Infinity : diffMs / 60000;
```

An `asof` more than 60s in the future now reads as `Infinity` age — the same sentinel already used
for the pre-existing NaN/unparseable-`asof` case directly above this code — which fails the
`ageMin <= TOL.freshnessMin` comparison and correctly FLAGs. An ordinary small future skew (a few
seconds, well inside normal clock drift) still reads as fresh, matching
`ZERODTE_MARK_FUTURE_TOLERANCE_MS`'s own documented purpose (per `marks-math.ts`'s comment: real but
small clock skew between a quote source and the server is expected and must not be flagged). Also
hardened the off-RTH "skipped" branch's message/field so it renders sensibly for the `Infinity`
case instead of printing `NaN`/`Infinitym`.

**Fix rationale:** importing the existing exported constant from `marks-math.ts` (not duplicating
the number, and not importing the heavier `data-integrity-verifier.ts` module, whose own test suite
needs five `mock.module()` stubs for its DB/Redis/cron-health import graph) keeps this a minimal,
single-purpose fix with no new test-setup burden on `heatmap-verifier.test.ts`, which already loads
every other `@/...`-aliased import for real. `marks-math.ts` has zero imports of its own (confirmed
via `grep "^import" src/lib/zerodte/plan.ts` — empty), so this import adds no meaningful new
dependency surface to the correctness verifier.

**Blast radius:** `freshnessCheck` is called from exactly one place, `verifyHeatmapTicker`'s runner
list, for every ticker the Heat Maps correctness sweep checks (SPX/SPY/QQQ/NVDA by default, or
`CORRECTNESS_TICKERS`). No other file in `src/lib/correctness/` reimplements this specific
age-from-`asof` computation inline — `data-integrity-verifier.ts`'s own `ageMin()` already carries
the fix; the other verifiers (`desk-verifier.ts`, `flows-verifier.ts`, `nighthawk-verifier.ts`,
`market-context-verifier.ts`, `track-record-verifier.ts`, `largo-verifier.ts`) were not in scope for
this round (owned-lane exclusions) and were not touched.

**Verification:** `npx tsc --noEmit` clean. `npx eslint` clean on both touched files. Full suite
(`npm test`, Node 20): **17915 pass / 0 fail / 3 skipped** (pre-existing skips, unrelated).
