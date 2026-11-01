> **kind:** FINDING

## `followUser()` collapsed ANY 403 from X's `/following` endpoint into `already_following` — FIXED

**Status:** FIXED (PR pending — `fix/x-follow-403-already-following`)

### Root cause

`src/lib/x-api.ts`'s `followUser()` classified the engagement engine's follow attempts
into `"ok" | "rate_limited" | "failed" | "already_following"`. The non-2xx branch read:

```ts
if (
  res.status === 403 ||
  res.status === 409 ||
  /already/i.test(body) ||
  /duplicate/i.test(body)
) {
  return "already_following";
}
return "failed";
```

Any bare HTTP 403 from X's `POST /2/users/:id/following` was unconditionally mapped to
`already_following`, with no look at the response body at all. X returns 403 for several
unrelated reasons on this endpoint — the target account blocked us, the target account is
suspended/protected-and-rejected, or our app/access tier lacks write permission for
follows — none of which mean "we already follow this account". Only a 409 Conflict, or a
body that actually says "already"/"duplicate", is real evidence of that specific case.

This is the exact "a 403 rendered as a measurement instead of a blind spot" bug shape this
repo already names explicitly in `src/lib/x-intel/queue-types.ts`'s `XIntelBlindSpot`
doc comment (a different lane, same shape) — a real failure silently reported as a benign,
already-handled state.

### Blast radius

`src/lib/x-engage-engine.ts`'s `tryFollow()` is the only caller. On `already_following` it
does nothing but skip (deliberately, to save follow budget) — it does **not** push to
`stats.errors`, so this miscategorization means:
- Every genuine follow failure that happens to 403 (blocked, suspended target, insufficient
  API access tier) was silently absorbed as "normal, already following" with zero error
  signal, forever.
- If the account's API access tier ever lost write permission for follows entirely, *every*
  follow call would 403 and the growth engine would silently report clean sweeps
  (`stats.errors` empty) while never actually following anyone — exactly the kind of
  "measured zero conflated with absence" failure mode this audit keeps finding elsewhere in
  the codebase, just on the X-growth lane this time.

No other caller of `followUser`/`already_following` exists in the repo (verified via grep).

### Fix

Extracted the classification into a pure, exported, unit-tested function
`classifyFollowError(status, body)` and removed the blanket `status === 403` branch — a
403 is now `already_following` only when the body itself says so (or on a genuine 409).
Everything else (including an unexplained bare 403) now correctly surfaces as `"failed"`,
which `tryFollow()` already pushes to `stats.errors` for visibility.

### Evidence (RED → GREEN)

Added `src/lib/x-api.test.ts` cases for `classifyFollowError` covering: a bare 403 with no
already/duplicate wording (must be `"failed"`), a 403 whose body does say
already/duplicate (must be `"already_following"`), a bare 409 (`"already_following"`
regardless of body), and an unrelated 401/500 (`"failed"`).

- Against the pre-fix source (function not yet exported): 4/9 tests in the file failed —
  `TypeError: classifyFollowError is not a function` / `undefined`.
- Against the fix: 9/9 pass.
- `src/lib/x-engage-engine.test.ts` (the only consumer's own suite): 3/3 suites, all pass,
  unaffected.
- `tsc --noEmit`: clean.

### Fix rationale

Kept the fix as a pure extraction rather than touching any caller logic — `tryFollow()`'s
existing `already_following` → no-op and `failed` → `stats.errors.push` handling is
correct and unchanged; the only thing wrong was which bucket a bare 403 landed in. No
gate, budget, or retry behavior was altered.
