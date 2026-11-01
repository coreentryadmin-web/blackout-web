> **kind:** FINDING

## `x-intel` cron's skip-reason log is backwards — the always-reachable branch logs the dead branch's message — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** code audit of `src/app/api/cron/x-intel/route.ts` (discovery-lane sweep of
non-excluded cron routes, 2026-11-01), while checking sibling `src/lib/x-content-schedule.ts`'s
`isPostWindow`/`selectPostType` contract for the DST-bug-shape this session's mandate prioritized
(unrelated to that search — `x-content-schedule.ts` itself is untouched here, it is mid-fix on
open PR #7224).

**Root cause:** `route.ts`'s `GET` handler built the "why we skipped this cron run" message as:

```ts
const postType = forceType ?? selectPostType(et);
if (!postType) {
  const inWindow = isPostWindow(et);
  reason: inWindow
    ? "Outside 2-hour post window"
    : `No post slot at hour ${et.getHours()}`,
```

`selectPostType`'s own guard (`src/lib/x-content-schedule.ts`) is `if (!isPostWindow(nowEt)) return
null;`, and every hour `isPostWindow` admits is covered by `EDT_HOUR_TO_TYPE`/`EST_HOUR_TO_TYPE`
(weekdays) or unconditionally mapped to `"weekend_desk"` (weekends) — so there is no hour for which
`isPostWindow(et)` is true and `selectPostType(et)` still returns `null`. That means a `null`
`postType` (with no `forceType` override, the only way this branch is reached) can **only** happen
when `isPostWindow(et)` is **false** — `inWindow` is provably `false` every single time this
branch actually runs. The ternary's `true` arm (`"Outside 2-hour post window"`) is therefore dead
code, and the always-taken `false` arm logs `"No post slot at hour N"` for every real skip — the
wrong diagnosis: that phrasing reads as "we're in the post window but have no mapping for this
hour" (a configuration bug), when the real and only reachable condition is simply "it isn't post
time." The sibling `x-autopost` route (`src/app/api/cron/x-autopost/route.ts`) already gets this
right — it never re-calls `isPostWindow`, with an explicit comment: *"selectPostType returned
null, which means isPostWindow(et) is false."*

**Evidence:** reproduced the exact pre-fix ternary standalone (same inputs the live branch always
has — `inWindow = false`, an arbitrary off-window hour):
```
Current (buggy) message: No post slot at hour 3
Expected message: Outside 2-hour post window
```
Also confirmed statically: `isPostWindow`'s hour sets (`WEEKEND_POST_HOURS`, and the DST-selected
`[8,10,12,14,16,18,20]`/`[7,9,11,13,15,17,19]`) are byte-identical to the hour keys of
`EDT_HOUR_TO_TYPE`/`EST_HOUR_TO_TYPE`/the weekend branch's unconditional `"weekend_desk"` — there
is no key in one set missing from the other, so the "in window but no type" case this ternary's
`true` arm exists to describe cannot occur.

**Blast radius:** this is purely an observability/diagnostics defect — it changes only the
`message`/`reason` string written to `cron_job_runs` (surfaced on the admin cron-health dashboard
and in CloudWatch), never which post actually fires or when. No other call site builds this same
message; `x-autopost/route.ts` (the sibling cron for the same desk-post feature) was already
correct and untouched.

**Fix:** extracted the decision into a new pure, exported helper,
`noPostTypeSkipReason(inWindow, hour)`, in the route's existing pure-helpers sibling file
(`src/app/api/cron/x-intel/x-intel-time.ts` — the file this exact route already uses for its other
pure ET helpers, per that file's own module doc), with the ternary direction corrected and a doc
comment explaining why `inWindow` is provably `false` in the only reachable call. `route.ts` now
calls it instead of inlining the (backwards) ternary. The conditional is kept rather than collapsed
to the single reachable branch, as a canary: if `isPostWindow`/`selectPostType`'s hour sets ever
drift apart in the future, `inWindow` becoming `true` here would be a genuinely new, more specific
failure worth its own distinct message.

**Fix rationale:** fixing in the shared pure helper (rather than just swapping the inline ternary
in `route.ts`) keeps the fix unit-testable the same way every other helper in this file already is,
consistent with that file's own stated purpose and the established pattern for this route (App
Router rejects non-route exports from `route.ts` itself, hence the sibling file).

**Evidence (RED → GREEN):** added 2 test cases to
`src/app/api/cron/x-intel/x-intel-time.test.ts` for the new `noPostTypeSkipReason` helper.
RED (temporarily restoring the pre-fix ternary order inside the new helper):
`npx tsx --experimental-test-module-mocks --test x-intel-time.test.ts` → 5 pass, **2 fail**
(both new assertions, expecting `"Outside 2-hour post window"` but getting
`"No post slot at hour N"`).
GREEN (post-fix): same command → **7/7 pass**.
`npx tsc --noEmit`: clean. `npx eslint route.ts x-intel-time.ts x-intel-time.test.ts`: clean.
