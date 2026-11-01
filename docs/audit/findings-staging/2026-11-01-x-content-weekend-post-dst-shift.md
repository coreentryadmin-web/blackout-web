> **kind:** FINDING

## X marketing "weekend desk" posts silently stop firing from the November DST changeover through March — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** cold read of `src/lib/x-content-schedule.ts` (round 283 correctness audit), cross-
checked against the file's own existing EST/EDT regression tests in `x-content-schedule.test.ts`
and confirmed live with a scratch script exercising `isPostWindow` at every real EST firing hour.

**Root cause:** `src/app/api/cron/x-autopost/route.ts` and `src/app/api/cron/x-intel/route.ts`
are both driven by ONE EventBridge schedule with fixed UTC fire times (the file's own top
comment: UTC `[12,14,16,18,20,22,0]`), on BOTH weekdays and weekends. `isPostWindow()`'s weekday
branch correctly accounts for this: it calls `isDST(nowEt)` and picks between
`[8,10,12,14,16,18,20]` (EDT) and `[7,9,11,13,15,17,19]` (EST) ET-hour sets, because the same
fixed UTC times land on a different ET wall-clock hour depending on the season.

The weekend branch (`if (dow === 0 || dow === 6) return (WEEKEND_POST_HOURS as readonly
number[]).includes(h);`) did **not** do this — `WEEKEND_POST_HOURS` was a single fixed `[10,
14]`, with no DST adjustment at all. That pair is only ever the real ET arrival hour under EDT.
Under EST, the identical UTC cron fires land on ET 9 and 13 instead (exactly the same one-hour
shift the weekday branch already handles), and `[10, 14]` never matches either of those hours —
so every real winter-weekend cron invocation computed `isPostWindow() === false`, and
`selectPostType()` returned `null` instead of `"weekend_desk"` at every one of them.

**Why it was never caught:** the bug is silent and self-healing in the worst way for staying
hidden — no error, no failed request, no log line; the cron keeps firing seven times a day on
Saturday/Sunday exactly as scheduled, it just never recognizes any of those times as a post
window. The symptom (no weekend posts) only exists for roughly the five months a year DST is
off, then disappears on its own every March when EDT resumes — which is precisely the seasonal,
intermittent shape `scripts/audit/cron-dst-audit.mjs`'s own header describes for its "ET-GATED"
bug class (a route that gates on an ET wall-clock condition that stops being satisfied under the
other DST offset). The existing test suite for this file has thorough EDT/EST coverage for the
*weekday* hour sets (`"DST: post window works during EST (Nov-Mar) at shifted hours"`, `"...
during EDT ..."`) but had no equivalent weekend case — the one Saturday test in the file
(`"weekend posts still allowed on non-trading Saturdays"`) uses `2026-09-05T10:30:00-04:00`, an
EDT date, so it could never have caught the EST gap.

**Live confirmation (scratch check, pre-fix):** for Saturday 2026-01-10 (EST), calling
`isPostWindow()` at every one of the 7 real ET arrival hours the fixed UTC schedule produces
under EST (`[7,9,11,13,15,17,19]`) returned `false` at **all seven** — zero weekend post windows
recognized that day, versus 2 intended (10am/2pm ET equivalent).

**Fix:** split `WEEKEND_POST_HOURS` into `EDT_WEEKEND_POST_HOURS = [10, 14]` and
`EST_WEEKEND_POST_HOURS = [9, 13]`, and have the weekend branch of `isPostWindow()` select
between them via the same `isDST(nowEt)` check the weekday branch already uses — mirroring the
existing EDT/EST pattern exactly rather than inventing a new mechanism. `selectPostType()` needed
no change: it already calls `isPostWindow()` first and only branches on `dow` afterward to return
`"weekend_desk"`, so once `isPostWindow()` recognizes the real EST hours, the post type resolves
correctly with no further changes.

**Fix rationale:** fixing at `isPostWindow()` (rather than, say, overriding `WEEKEND_POST_HOURS`
dynamically at the call sites in the two cron routes) keeps the DST-awareness entirely inside this
one pure, already-tested scheduling module, consistent with how the weekday case is handled, and
needs no change to either cron route.

**Blast radius:** only one other read site, `src/lib/x-content.ts`, which merely re-exports
`isPostWindow`/`selectPostType` without its own logic — not affected beyond picking up the fix
transitively. No other file references `WEEKEND_POST_HOURS`.

**Evidence (RED → GREEN):** added a new test, `"DST: weekend post window shifts with EST the same
way weekdays do"`, to `src/lib/x-content-schedule.test.ts`, using the same `mkET` helper pattern
already established in the file's sibling EST tests, for Saturday 2026-01-10 (EST):
- RED (pre-fix, `WEEKEND_POST_HOURS` stashed back to its original fixed `[10, 14]`):
  `npx tsx --experimental-test-module-mocks --test src/lib/x-content-schedule.test.ts` →
  **7 pass, 1 fail** (`isPostWindow(mkET(9))` expected `true`, got `false`).
- GREEN (post-fix): same command → **8/8 pass**.
- `npx tsc --noEmit`: clean.
