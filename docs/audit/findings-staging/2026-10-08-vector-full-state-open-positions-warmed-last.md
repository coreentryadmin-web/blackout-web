## 2026-10-08 — [FINDING, largo-swing] `vector-full-state-snapshot`'s warm cron put real open swing positions LAST in its rotation order, so the highest-stakes tickers were the last ones warmed in every lap — FIXED (open positions now lead the rotation)

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (no bad numbers served — an honest `unavailableSources`/"fetch failed" disclosure per the Largo absence contract — but the exact population the rotation/TTL fixes exist to protect, real committed capital, was structurally the LAST to benefit from them) |
| **Component** | `src/features/vector/lib/vector-full-state-warm-universe.ts` (`activeVectorFullStateTickers`) |
| **PR** | fix/vector-full-state-open-positions-first |
| **Found via** | Ask Largo standing sub-mandate — verifying #5705 (TTL raise) actually closes the member-facing gap, this cycle's 5-engine live monitor sweep |
| **Related** | Complementary to the same-day rotating-cursor fix (`rotateTickersForWarmPass`) and TTL raise (`VECTOR_FULL_STATE_CACHE_TTL_SEC`, #5705, staged separately as `2026-10-08-vector-full-state-ttl-rotation-mismatch.md`). Both of those fix *how long* a warm entry survives and *whether* the rotation eventually reaches every ticker; this fix changes *which ticker gets warmed first*. |

### Root cause

`activeVectorFullStateTickers()` built its output as
`mergeSharedUniverseTickers(sharedStaticAndDynamicUniverse, openSwingPositionTickers)` — the shared
static-allowlist-plus-member-viewed universe FIRST, real open swing positions APPENDED after. This
list's order is exactly what `rotateTickersForWarmPass`'s cursor walks each cron cycle. So even with
the rotation-starvation fix and the TTL raise both working exactly as designed, real committed
positions were structurally the LAST names a rotation lap would reach — the opposite priority from
what the function's own doc comment says the open-position union exists for: "real capital, the
highest-stakes blast radius."

### Evidence

Live `GET /api/market/swing/play-brief` for three real, currently-committed swing positions (CIEG,
MRNA, PSX — picked fresh, not previously audited), run ~2 hours AFTER the #5705 TTL fix had deployed
and with the rotating cursor confirmed advancing through at least 1.5 full laps in that window
(CloudWatch `cursor=` sequence 0→38→0→...→18), still returned:

```
unavailableSources: [
  {"source":"ecosystem context","reason":"fetch failed","retryable":true},
  {"source":"Vector state","reason":"fetch failed","retryable":true}
]
```

CloudWatch confirms the exact mechanism — a genuine cache-miss-driven timeout, not a thrown provider
error:

```
[swing-play-brief] ecosystem context fetch failed for CIEG: SwingBriefSourceTimeout: brief source read exceeded 8000ms
[swing-play-brief] Vector full-state fetch failed for CIEG: SwingBriefSourceTimeout: brief source read exceeded 8000ms
[swing-play-brief] ecosystem context fetch failed for MRNA: SwingBriefSourceTimeout: brief source read exceeded 8000ms
[swing-play-brief] Vector full-state fetch failed for MRNA: SwingBriefSourceTimeout: brief source read exceeded 8000ms
[swing-play-brief] ecosystem context fetch failed for PSX: SwingBriefSourceTimeout: brief source read exceeded 8000ms
[swing-play-brief] Vector full-state fetch failed for PSX: SwingBriefSourceTimeout: brief source read exceeded 8000ms
```

Not a regression in #5705 — the TTL fix makes a WARM entry survive longer; it does nothing for an
entry that is never first in line to be warmed each lap. CIEG/FUBO/CCOI/MRNA/ADSK/PSX (and ~30 more)
are all real `SWING` committed positions on the live board at probe time — all tail-ordered in the
old merge, all paying the same 8-second hard timeout on every Ask Largo brief until their turn
eventually comes up, once per ~160-minute lap.

### Fix

Swapped the merge order: `mergeSharedUniverseTickers(openSwingPositionTickers,
sharedStaticAndDynamicUniverse)`. `mergeSharedUniverseTickers` keeps only the first occurrence of a
de-duplicated ticker, so this also means a ticker that is BOTH a static-allowlist name AND a real
open position now keeps its (earlier) position-derived slot — a strict improvement, never a
regression, since that ticker is more deserving of priority either way. The shared static/dynamic
universe is still fully covered every lap; it is simply warmed after the highest-stakes names
instead of before them.

### Regression test

`src/features/vector/lib/vector-full-state-warm-universe.test.ts` — new test asserts
`activeVectorFullStateTickers()` returns open positions BEFORE the shared universe, in that exact
order (`["HUT","MSTR","SPY","SPX","AAPL"]` for a 2-position / 3-shared fixture). RED against the
pre-fix order (`git stash` of only the source file, keeping the new test) — failed on the expected
vs actual order. GREEN after the fix — 10/10 tests pass in the file (plus the 4 pre-existing
order-independent tests still pass unchanged). Full suite (`npm test`, Node 20): 15820 pass / 0
fail / 3 skip. `tsc --noEmit` clean.

Also corrected two now-stale doc comments (`vector-full-state-cache.ts`, this same file's own
header) that still cited the pre-#5705 "15-min TTL" as a current fact rather than the historical
value it was when originally written — harmless on their own, but exactly the kind of staleness this
repo's own `CLAUDE.md` warns against trusting at face value.

### Blast radius

Single call site (`src/app/api/cron/vector-full-state-snapshot/route.ts`), confirmed via repo-wide
grep before editing. No change to `mergeSharedUniverseTickers`, `rotateTickersForWarmPass`,
`listSharedUniverseTickers`, the cron's own budget/concurrency, or any other reader of the
`vector:full-state:*` cache. `heatmap-warm`/`vector-walls-warm` (the OTHER crons that warm the
shared static/dynamic universe) call `listSharedUniverseTickers()` directly, not this function, so
their own warm priority is completely unaffected by this change.
