## 2026-10-20 — [FINDING, P3 Input-validation] A malformed `limit` body field silently no-ops the whole admin bulk tool-access operation — FIXED

> **kind:** FINDING

**Context.** DISCOVERY-lane input-validation sweep. Same sweep that found the 3-site
`?? default`-survives-NaN pattern fixed in a separate PR (`2026-10-20-nan-limit-survives-
nullish-coalescing.md`) — this one is a related but distinct root cause: not a `slice()`
silently returning `[]`, but a `while` loop condition that's `false` from the start.

**Root cause.** `src/app/api/admin/users/tools/bulk/route.ts:36`:
```js
const limit = Math.min(500, Math.max(1, Number(body.limit ?? 200)));
```
`body.limit ?? 200` only guards an absent field. A malformed one — e.g. the non-numeric
string `"all"`, a plausible value someone might send meaning "no cap" — produces
`Number("all")` = `NaN`. `NaN` is neither `null` nor `undefined`, so it survives `??`, and
then poisons both `Math.max(1, NaN)` and `Math.min(500, NaN)`, each of which also evaluates
to `NaN`. The route's own work loop is `while (updated < limit)` (line 54): `0 < NaN` is
`false`, so the loop body never executes even once.

**Live impact.** `POST /api/admin/users/tools/bulk` with
`{"tier":"premium","tool":"vector","mode":"grant","limit":"all"}` returns
`200 {ok:true, updated:0, scanned:0, errors:[]}` — a clean success response that reads
exactly like "no premium users exist to update," when the real cause is a malformed `limit`
field silently defeating the entire operation. An admin acting on this response would
reasonably conclude the tier has no members, not that their own request was malformed.

**Fix.** Added `|| 200` after `Number(body.limit ?? 200)`, matching the same safe idiom used
in the sibling fix PR (`flows/route.ts`'s existing pattern): `NaN` is falsy, so `|| 200`
catches it where `?? 200` could not.

**Blast radius.** Single call site, single route — `limit` is read nowhere else in this
file.

**Evidence of fix.** New test `src/app/api/admin/users/tools/bulk/route.test.ts` (no prior
test file existed for this route) asserts the `|| 200` guard is present. RED→GREEN proven
via `git stash` on just `route.ts`: fails on the pre-fix source (`not ok 1`), passes once the
fix is restored. `tsc --noEmit` clean.

**What was deliberately left unchanged.** The two other genuine findings from the same sweep
(`2026-10-20-nan-limit-survives-nullish-coalescing.md`'s 3 sites, and `admin/users`'s GET
pagination uncaught-exception path) are separate root causes/fixes, each in their own PR.
