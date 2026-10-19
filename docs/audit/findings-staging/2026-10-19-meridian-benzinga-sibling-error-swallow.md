> **kind:** FINDING

## 2026-10-19 — [FINDING, P2 Meridian] Two sibling Benzinga loaders still swallowed fetch failures into a generic "cache_error" string, missed by the 2026-08-18 fix — FIXED

| **Status** | FIXED |
|---|---|

**Severity:** P2 — live, member-facing honest-absence violation (not a crash), same root-cause class as the already-fixed 2026-08-18 Meridian ESTIMATES/HISTORY-empty P1 (`docs/audit/FINDINGS.md`, re-confirmed FIXED on 2026-08-30).

**What's wrong.** `src/lib/meridian/meridian-benzinga-earnings.ts`'s `loadBenzingaTickerEarnings` was fixed on 2026-08-18 to (a) explicitly `throw` when the provider returns `{error: ...}` without itself rejecting — so a soft failure is never cached as an indistinguishable empty result — and (b) carry the real thrown message through its `.catch()` instead of a generic string. Two sibling functions in the **same file**, doing the exact same `serverCache(...).catch(...)` shape, were never given the same fix:

- `loadBenzingaBoardEarnings(tickers, todayYmd, daysAhead)` — called from `loadMeridianEarningsTimeline` (`meridian-timeline-server.ts`), merged directly into the market-wide earnings timeline with no error check at the call site. A real upstream failure silently produces a timeline missing those tickers' prints.
- `loadBenzingaTickerGuidance(ticker)` — called from `loadMeridianEarningsEnrichment` (`meridian-earnings-enrich.ts`), the **exact same `Promise.all`** the 2026-08-18 fix already lives in. A fetch failure here resolved to `corporate_guidance: null`, `guidance_entitled: false`, `guidance_on_file: false` — indistinguishable from "this company has no corporate guidance on file," which is precisely the confusion the 2026-08-18 fix's own comment warns about one line above: *"An outage must be distinguishable from an empty company... measured on 8/8 mega-caps."*

**Root cause.** The 2026-08-18 fix was scoped to the one function whose live reproduction (8/8 mega-caps) proved the defect, and the PR write-up policy's "every other call site/consumer touched by the same root cause" sweep did not extend to these two textually-adjacent sibling functions in the same file at the time.

**Fix.**
- `loadBenzingaBoardEarnings` and `loadBenzingaTickerGuidance` now both throw on `res.error` inside the cached loader (so a soft provider error is never cached as a real empty answer) and carry the real thrown message through their `.catch()`, mirroring `loadBenzingaTickerEarnings` exactly.
- `loadMeridianEarningsEnrichment`'s existing `calendar_error` field (already the designated "an outage must be distinguishable from an empty company" signal) now also checks `guidanceRes.error`, closing the one sibling fetch in that `Promise.all` that wasn't feeding it.
- `loadBenzingaBoardEarnings`'s error is not yet wired into `MeridianEarningsTimelineResult` (a new field on a shared result type, out of scope for this fix) — its caller (`loadMeridianEarningsTimeline`) still silently drops it; this remains a known gap, not claimed as closed.

**Blast radius — a third instance found, deliberately not fixed here.** `loadBenzingaEarningsBundle` (same file, ~line 68) has the identical "cache_error" literal twice — its inner `hist` fetch catch (~line 104) and its outer whole-function catch (~line 149-162) — but is structurally more complex than the two functions fixed above: it interleaves two unguarded parallel `fetchBenzingaStructuredEarnings` calls, revision-diffing (`diffEstimateRevisionTimeline`), and a Redis-persistence side effect (`recordMeridianEstimateRevision`) inside the same cached block, so applying the same throw-and-carry fix correctly needs more careful scoping than a mechanical copy of the pattern (in particular, whether `windowRes.error`/`revisionRes.error` should also gain a throw guard changes caching behavior for a function with more interdependent fields than the two already fixed). Left as a follow-up rather than risking a rushed fix to a more delicate function in the same PR as the two clean ones.

**Regression test.** `src/lib/meridian/meridian-benzinga-earnings.test.ts` (new file, 4 tests): proves both functions carry the real provider error — for both a hard-thrown fetch exception and a soft `{error: ...}` response — instead of the literal string `"cache_error"`, and that a genuinely empty/no-error result still returns cleanly. Proved RED (2/4 fail, `got: cache_error`) against the pre-fix source via `git stash`, GREEN (4/4) after.

**Verification.** `npx tsc --noEmit` clean. `npx eslint` clean on both touched files + new test. Full Meridian suite (`src/lib/meridian/*.test.ts src/features/meridian/**/*.test.ts`): 528/528 pass, no regressions. Full `npm test` run in progress at time of writing (background, to be confirmed before merge).
