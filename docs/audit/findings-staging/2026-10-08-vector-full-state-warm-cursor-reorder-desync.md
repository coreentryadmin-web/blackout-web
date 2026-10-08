## 2026-10-08 — [FINDING, largo-swing] `vector-full-state-snapshot`'s persisted warm-rotation cursor was a raw array index, which silently desynced the moment the same-day position-first reorder (#5709) shipped — FIXED (cursor is now content-addressed by ticker name)

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (no bad numbers served — an honest `unavailableSources`/"fetch failed" disclosure per the Largo absence contract — but it silently defeated the SAME-DAY #5709 reorder's whole stated purpose, "real committed capital gets warmed first," for a full rotation lap right after that fix deployed) |
| **Component** | `src/features/vector/lib/vector-full-state-warm-universe.ts` (`rotateTickersForWarmPass`'s caller), `src/app/api/cron/vector-full-state-snapshot/route.ts` |
| **PR** | fix/vector-warm-cursor-reorder-desync |
| **Found via** | Ask Largo standing sub-mandate — verifying live whether #5709 (open positions warm FIRST) had actually closed the member-facing gap, this cycle's 5-engine live monitor sweep |
| **Related** | Fourth layer in the same incident chain this cycle's mandate already names: cache starvation (#5701) → TTL mismatch (#5705) → warm-order priority (#5709) → this: the persisted rotation cursor itself desyncing the moment #5709's own reorder changed the list it indexes into. |

### Root cause

`vector-full-state-snapshot/route.ts` persists `WARM_CURSOR_KEY` in Redis as a bare **number** —
a raw offset into whatever `activeVectorFullStateTickers()` returns — and feeds it straight back
into `rotateTickersForWarmPass(rawTickers, cursor)` on the next run. That is only safe while the
underlying list's **order** is stable across runs: a numeric offset means "skip this many array
slots," not "resume after ticker X." The moment the list's order changes, the SAME stored number
points somewhere completely different.

#5709 (committed earlier the same day) is exactly such a change: it moved ~35 real open swing
positions from the TAIL of the merged universe to the HEAD. The cursor that had been persisted
under the OLD (positions-last) order — correctly, deep into the shared-universe tail, about to
reach the appended positions soon — was still read back and replayed as a raw index against the
NEW (positions-first) list. With positions now occupying the first ~35 indices, that same stored
number landed the rotation start back in the shared-universe tail again, nowhere near the
positions it was supposed to finally prioritize. The rotation could only reach them again once the
raw index happened to wrap all the way back around past the list length — a delay of a full lap
(tens of minutes at this cron's ~2-6-tickers-per-5-minute-run budget), directly during the exact
window the reorder fix was supposed to start mattering.

### Evidence

CloudWatch, same session as #5709's deploy (`createdAt` 18:42:50 UTC):

```
18:41:11 cursor=34 attempted=6 ... (pre-deploy, OLD positions-last order)
18:46:12 cursor=40 attempted=4 ... (post-deploy; NEW positions-first order — but cursor=40 replayed
                                     as a raw index lands in the shared-universe tail, not on any
                                     of the ~35 positions now sitting at indices 0-34)
18:51:35 cursor=44 attempted=4 ...
18:56:08 cursor=48 attempted=2 ...
```

and, live `GET /api/market/swing/play-brief` for three real open positions near the FRONT of the
new, post-#5709 order (FUBO, CRDU, LQDA — picked fresh), fourteen-plus minutes after the reorder
deployed and three rotation runs after it:

```
18:56:04 [swing-play-brief] ecosystem context fetch failed for FUBO: SwingBriefSourceTimeout: brief source read exceeded 8000ms
18:56:16 [swing-play-brief] ecosystem context fetch failed for CRDU: SwingBriefSourceTimeout: brief source read exceeded 8000ms
18:56:35 [swing-play-brief] ecosystem context fetch failed for LQDA: SwingBriefSourceTimeout: brief source read exceeded 8000ms
```

Re-checking a few minutes later (as the cursor continued advancing and/or racy cold-compute
happened to land inside the 8s budget) showed these specific names recovering — consistent with
the gap being real but transient-and-worsened-by-the-stale-cursor, not a permanent break. The code
defect itself (a raw index silently misinterpreting a reordered list) is independent of that
moment-to-moment raciness and is proven directly by the regression test below, not inferred from
live timing alone.

### Fix

Added `resolveWarmCursorIndex(tickers, lastAttemptedTicker)` (content-addressed: finds the
remembered ticker NAME in TODAY's list and resumes right after it; falls back to index 0 — i.e.
the current highest-priority names — when the ticker is no longer present, which costs at most one
extra partial pass over already-warm entries, the cheaper failure mode). The cron now persists the
cursor as the ticker **name** last attempted (`WARM_CURSOR_KEY` is now a string, not a number) and
resolves it to a numeric rotation start fresh each run via this helper, instead of trusting a raw
offset to still mean the same thing.

This is not a one-off patch for today's specific reorder — any FUTURE change in
`activeVectorFullStateTickers()`'s shape (a position opens/closes, the dynamic/shared universe's
membership shifts) now resumes "right after whatever we actually finished," wherever that ticker
now sits, rather than at a raw offset that silently means something else once the list underneath
it moves.

A second, narrower bug surfaced while writing this fix itself: the Redis key's VALUE TYPE is
changing (number → ticker-name string) as part of this same change. The FIRST read after this
ships still returns whatever the OLD code last persisted — a bare number — and `JSON.parse`
round-trips a number as a number, not a string, so a naive `lastAttemptedTicker.trim()` would
throw on that exact leftover value on the very next cron run after deploy. `resolveWarmCursorIndex`
takes `unknown` (not `string`) and explicitly checks `typeof` before calling any string method, so
a leftover number degrades to "no remembered ticker" (resume at 0) instead of crashing the cron
for one release. The route's own read is typed `<unknown>`, not `<string>`, for the same reason —
claiming `<string>` would be a lie the type system cannot check across a Redis round-trip.

### Regression test

`src/features/vector/lib/vector-full-state-warm-universe.test.ts` — new tests for
`resolveWarmCursorIndex` (resume-after-ticker, fallback-to-0 when absent/unknown, case
insensitivity, and a dedicated test proving a leftover raw NUMBER from before this fix never
throws) plus a dedicated reorder-regression test that reconstructs the EXACT live scenario
(a cursor computed under the old shared-then-positions order, replayed against the new
positions-then-shared order): proves a raw numeric cursor lands back in the shared-universe tail
(not on any position), while the content-addressed resolver correctly wraps straight into the open
positions. `src/app/api/cron/vector-full-state-snapshot/route.test.ts` updated (new import/call
patterns) plus a new test asserting the old number-cursor shape (`sharedCacheGet<number>`,
`(cursor + attempted) % rawTickers.length`) is never reintroduced.

RED→GREEN via `git stash` of only the source file (`vector-full-state-warm-universe.ts`), keeping
the new tests: 4 failures (`resolveWarmCursorIndex is not a function`) pre-fix, 0 failures,
14/14 pass post-fix (same file); `route.test.ts` 9/9 pass. Full suite (`npm test`, Node 20) and
`tsc --noEmit` both clean — see this PR's CI run for the current head SHA.

### Blast radius

Two files touched: `vector-full-state-warm-universe.ts` (new exported helper, additive — the
existing `rotateTickersForWarmPass` and `activeVectorFullStateTickers` are unchanged) and
`vector-full-state-snapshot/route.ts` (the cron's own cursor read/write, its only call site —
confirmed via repo-wide grep before editing). No other cron or reader touches `WARM_CURSOR_KEY`;
`heatmap-warm`/`vector-walls-warm` use `listSharedUniverseTickers()` directly and have no cursor of
their own, so they are unaffected.
