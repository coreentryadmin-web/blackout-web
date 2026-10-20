## 2026-10-20 — [FINDING, P3 Error-handling] admin/users create + sync swallow a real Clerk/Whop failure with zero server-side log — FIXED

> **kind:** FINDING

**Context.** DISCOVERY-lane error-handling sweep, follow-up to the earlier batch of 5
GET-handler swallowed-error fixes (`#6357`). Dispatched a background sweep agent to look for
the same pattern — a bare `catch` with no logging — in POST/PUT/PATCH/DELETE handlers
outside the 9 owned lanes.

**Root cause.** Two routes in the same small admin-users module each wrap a real external
call in a `try`/`catch` whose `catch` block returns an error response with **no logging call
at all**:
- `src/app/api/admin/users/create/route.ts` — the outer `catch` wraps
  `client.users.createUser(...)` (Clerk). The strongest signal that this was missed rather
  than deliberate: a sibling `catch` 24 lines earlier in the SAME function (the Whop sync
  immediately after create) already does `console.warn("[admin-users] Whop sync after
  create failed:", err)`, and the success path two statements later does
  `console.log(...)`. The file logs on every other exit path except this one.
- `src/app/api/admin/users/sync/route.ts` — the outer `catch` wraps
  `syncWhopMembershipForEmail(...)` with no log before returning a 500. This is the exact
  same call that IS logged on failure one directory over, in `create/route.ts`'s own inner
  catch — the convention clearly exists in this module, just wasn't applied here.

**Consequence.** A failed admin user-creation (duplicate email, bad phone, Clerk-side
validation, Clerk outage) or a failed billing-tier sync (which directly affects what a
member can access) currently leaves zero server-side trace — an admin sees only a generic
error toast, with nothing in the logs to distinguish "duplicate email" from "Clerk API down"
after the fact.

**Fix.** Added `console.error("[admin-users] create failed:", err)` /
`console.error("[admin-users] sync failed:", err)` to each outer catch, before the existing
error-response logic (unchanged).

**Blast radius.** Two call sites, each the sole handler in its file — no other consumer.

**Evidence of fix.** New shared test file
`src/app/api/admin/users/admin-users-catch-logging.test.ts` checks both routes' outer catch
blocks for a `console.error(...)` call identifying the failing operation. RED→GREEN proven
via `git stash` on just the two route files: both fail on the pre-fix source (`not ok 1`,
`not ok 2`), both pass once the fix is restored. `tsc --noEmit` clean.

**What was deliberately left unchanged.** A third, lower-confidence candidate the same sweep
flagged — `src/app/api/auth/native-oauth/complete/route.ts`'s catch, which deliberately does
NOT leak error detail to the client for a stated security reason (a rejected identity token
could be a legitimate misconfig or an attacker probing) — is NOT fixed here: the file has no
sibling handler proving logging was "intended but missed," so whether the omission is
deliberate (vs. unintentional) is genuinely ambiguous and better raised as a question than
unilaterally changed. Noting it here for a future cycle rather than guessing.
