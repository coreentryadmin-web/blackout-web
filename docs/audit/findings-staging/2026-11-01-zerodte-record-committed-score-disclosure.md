> **kind:** FINDING

## 0DTE `/record` API serves two disagreeing "score" fields for the same play, and `by_score_band` buckets rows using the undisclosed one — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** live audit of `GET /api/market/zerodte/record?days=90` (production, 2026-11-01), via
`scripts/audit/lib/audit-auth-fetch.mjs`. Independently re-pulled 589 graded plays and cross-checked
against the response's own `by_score_band` aggregate.

**Root cause:** `src/lib/zerodte/record.ts`'s `toPlay()` set every play's top-level `score` to
`r.score_max` (line 835 pre-fix) — the session-PEAK evidence score, which keeps ratcheting UP
across scan ticks even AFTER the play commits. But `by_score_band` (line 931) buckets the SAME
rows through `scoreForBanding()` (line 672-677), which prefers `entry_context.score` — the REAL
commit-time score, the exact number the G-3 score-floor gate actually acted on — falling back to
`score_max` only when no `entry_context` exists. So the response shipped two different numbers for
"the score" of the identical play, with **no field and no methodology text anywhere in the JSON**
reconciling them. A consumer reading `plays[].score` sees the ratcheted peak; the response's own
`by_score_band` aggregate silently classifies that same row by the commit-time number — a
contradiction the payload gives no way to detect.

This is the exact gap a 2026-10-16 fix (`FINDINGS.md`) partially closed: that fix added an additive
`committed_score` field to `PlayHistoryTable.tsx` (the UI) and `product-reads.ts`'s Largo lean
payload (`leanZeroDtePlayForModel`), but its own blast-radius note explicitly scoped itself to
those two consumer surfaces and left `record.ts`'s underlying `buildZeroDteRecord`/`toPlay` — and
therefore this public API route itself — untouched. `grep -rn committed_score src/` before this fix
confirmed the field existed only in `product-reads.ts` and its tests; zero occurrences in
`record.ts` or the route.

**Live evidence (2026-11-01, 90-day window, 589 graded plays):**
- OKLO, session 2026-08-25: top-level `score: 100`, `entry_context.score: 50` — a play whose own
  row claims a peak score of 100 was counted in the response's own `"score <55"` bucket.
- 13/589 rows (2.2%), all dated 2026-08-25, cross a band boundary this way: APLD 71/50, ASST
  100/59, BULL 77/55, CLSK 94/53, COIN 87/56, CRML 100/61, MRNA 100/59, MSTR 89/52, OKLO 100/50,
  RDDT 70/51, RIOT 98/57, RKLB 69/61, RUM 100/54 (ticker, top-level score / `entry_context.score`).
- Independent recount: banding by the top-level `score` field alone gives 65+:588 / 55-64:1 /
  <55:0; banding by `entry_context.score` (the real `scoreForBanding` logic) gives 65+:575 /
  55-64:8 / <55:6 — exactly matching the API's own served `by_score_band` array
  (`[{"score 65+":575},{"score 55-64":8},{"score <55":6}]`).

**Fix:** `toPlay()` now also computes `committed_score` — the real `entry_context.score` — using
the identical additive-disclosure test `leanZeroDtePlayForModel` already used on the Largo surface
(a real, finite `entry_context.score` that actually DIFFERS from the peak `score`): present only
when it is genuinely new information, omitted (never fabricated or emitted as a redundant
duplicate) when there is no `entry_context`, a non-numeric/garbled `entry_context.score`, or the
commit score already equals the peak (no ratchet occurred). Because this field now lives on
`ZeroDteRecordPlay` itself — the shared type every consumer of `buildZeroDteRecord` reads — the
public `/api/market/zerodte/record` route, `PlayHistoryTable.tsx`, and the Largo tool all now carry
it from the SAME computation, rather than from independently-reimplemented copies.

**Fix rationale — why fix at the source rather than patch the route:** the route
(`src/app/api/market/zerodte/record/route.ts`) calls `buildZeroDteRecord` and ships the result
verbatim (`roundFloats(record)`), so fixing `toPlay()` fixes the route with no route-level change
needed at all. Patching only the route's response shape would have left `buildZeroDteRecord` itself
still representing an incomplete disclosure to every other consumer (e.g. `track-record-page.ts`'s
`zerodteFromRows`, which also calls `buildZeroDteRecord` directly for the public `/track-record`
SEO page — though that caller only forwards aggregates, not `plays[]`, so it was not actually
affected here, confirmed by inspection).

**Blast radius — other call site with the same (now-redundant) logic:** `product-reads.ts`'s
`leanZeroDtePlayForModel` independently re-derived `committed_score` from `entry_context.score`
with the identical test, since `ZeroDteRecordPlay` did not carry the field yet when that function
was written. Simplified it to just pass the field through (`play` already carries it, or already
honestly omits it, by the time this function runs) — removing a second, silently-driftable copy of
the same computation. Verified behaviorally identical: all 35 `product-reads.test.ts` cases
(including the dedicated `committed_score` tests) still pass unchanged.

Checked other call sites of `ZeroDteRecordPlay`/`buildZeroDteRecord` for the same root-cause bug:
- `src/lib/track-record-page.ts` (`zerodteFromRows`) — only forwards aggregate fields
  (`byScoreBand`, etc.), never `plays[].score` to any consumer. Not affected.
- `src/app/api/admin/zerodte/tier-export/route.ts` / `src/lib/zerodte/tier-export.ts` — reads the
  raw `ZeroDteSetupLogRow.score`/`score_max` columns directly for admin calibration export, a
  separate code path that never goes through `buildZeroDteRecord`/`toPlay`/`scoreForBanding`. Not
  affected (serves both raw fields plainly, by design, for calibration study use, not as a
  single "the score" the way the public record route does).
- `src/features/nighthawk/lib/analytics-panel.ts` — no `score` field usage at all. Not affected.

**Evidence (RED → GREEN):** added 3 test cases to `src/lib/zerodte/record.test.ts`:
1. Extended the existing MU fixture assertion (score_max 61, `entry_context.score` 54) to also
   check `committed_score` is disclosed.
2. A dedicated OKLO-shaped reproduction of the exact live bug (`score: 100`,
   `entry_context.score: 50`) asserting `committed_score` discloses 50 and that banding by it
   lands the row in `"score <55"`, matching the response's own `by_score_band`.
3. An omission test confirming `committed_score` stays absent for a row with no `entry_context`, a
   non-numeric `entry_context.score`, and a commit score equal to the peak (no ratchet).

RED (pre-fix `record.ts`, swapped in from `origin/main` while keeping the new tests):
`npx tsx --experimental-test-module-mocks --test record.test.ts` → 54 pass, **2 fail** (the two new
assertions expecting `committed_score`, both failing with `undefined !== <expected>`).
GREEN (post-fix): same command → **56/56 pass**. `npx tsc --noEmit`: clean.

Also re-ran the full blast-radius test set together (`record.test.ts`, `product-reads.test.ts`,
`PlayHistoryTable.test.ts`, `analytics-panel.test.ts`, `__tests__/track-record-page.test.ts`):
**125/125 pass.**
