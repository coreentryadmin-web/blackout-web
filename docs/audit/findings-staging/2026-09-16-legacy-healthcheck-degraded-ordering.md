## 2026-09-16 — [FINDING, FIXED] legacy-e2e-healthcheck's own verdict logic swallowed a degraded-fallback read into the wrong evidence message

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (audit tooling correctness — the production edition API itself was never wrong; this lane's own healthcheck misreported which kind of AMBER it was) |
| **Lane** | Night Hawk Legacy |
| **Files** | `scripts/audit/lib/legacy-healthcheck-eval.mjs`, `scripts/audit/lib/legacy-healthcheck-eval.test.mjs` |
| **PR** | (see PR link in commit trailer) |

### Root cause

`src/app/api/market/nighthawk/edition/route.ts`'s `timeoutFallbackEdition` is served when the
real edition computation blows past its time budget — a **transient read failure**, not a
confirmed "nothing published" result. Its own extensive header comment explains exactly why this
distinction matters (citing a real 2026-09-08 incident where a mid-session timeout read looked
identical to a genuinely quiet day). When no `lastGoodEdition` is cached for the process, it
returns:

```ts
return { ...emptyEdition(editionFor), degraded: true };
```

`emptyEdition()` always sets `available: false`. So this payload carries **both** `available:
false` and `degraded: true` at once — not one or the other.

`verdictForEdition` (`legacy-healthcheck-eval.mjs`) checked `available === false` *before*
`degraded`:

```js
if (available === false) return { verdict: "AMBER", evidence: "no edition published yet (honest empty state)" };
if (degraded) return { verdict: "AMBER", evidence: "edition served from degraded fallback source" };
```

Since the timeout-fallback payload always matches the first branch, `degraded` was **never
reached** for that exact shape — silently collapsing "a transient read failure happened" into "a
genuinely quiet day, nothing to see," precisely the confusion the route's own `degraded` flag
exists to prevent.

### Evidence

Live-reproduced 2026-09-16, 16:07 UTC (~noon ET, well before market close): a healthcheck run
reported Stage A as `"no edition published yet (honest empty state)"` for `edition_for:
2026-09-17`. A direct re-fetch of the same live endpoint (no explicit `?date=`) moments later
returned `available: true, edition_for: "2026-09-16"` with 3 real, correctly carried-forward
plays — the exact transient-timeout signature the route's `timeoutFallbackEdition` mechanism is
designed to produce and the `degraded` flag is designed to label honestly.

The existing test suite had a real gap that let this ship: it exercised `degraded: true` only
alongside `available: true` (a play-book-with-a-degraded-note case), never the actual
`available: false` + `degraded: true` combination `timeoutFallbackEdition` produces.

### Fix

Reordered the checks: `degraded` before `available === false`. A genuine not-yet-published state
(`available: false` with no `degraded` flag, from `emptyEdition()` called directly, not via the
timeout fallback) still correctly falls through to the "honest empty state" message unchanged —
this fix only changes behavior for the payload shape that carries both flags together.

### Regression tests

Two new tests in `legacy-healthcheck-eval.test.mjs`:
- `available:false` + `degraded:true` together → reports "degraded fallback", not "honest empty
  state".
- `available:false` alone (no `degraded`) → still reports the genuine "honest empty state"
  message, confirming the fix didn't just flip the message unconditionally.

RED→GREEN proven via `git stash` of the fix-only diff (eval file only, test file kept): 44/45
pass pre-fix (the new degraded-ordering test fails), 45/45 pass post-fix. `tsc --noEmit` clean.
Full suite run in progress.

### Blast radius

Only `verdictForEdition`'s Stage A judgment changes. `legacy-e2e-healthcheck.mjs`'s runner
already correctly extracted `degraded` from the live JSON response and passed it through — the
defect was purely inside the pure eval function's check order, nothing upstream needed touching.
No production API behavior is affected; this is audit-tooling-only.

### What was deliberately left unchanged

The production `/api/market/nighthawk/edition` route's own `timeoutFallbackEdition`/
`resolveNighthawkEdition`/carry-forward logic is untouched and was never the source of the
confusion — it already does exactly what its own comments describe. This fix only corrects how
the healthcheck's own verdict function interprets the payload it already receives correctly.
