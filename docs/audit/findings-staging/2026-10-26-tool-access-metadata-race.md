> **kind:** FINDING

## `setToolAccessForUserId` unlocked read-modify-write on Clerk `publicMetadata` — FIXED

**Status:** FIXED (`fix/tool-access-metadata-race`)

**Area:** `src/lib/tool-access-server.ts` — admin tool-access overrides (consumed by
`POST /api/admin/users/tools/bulk` and the single-user `PATCH /api/admin/users/[id]`
`toolAccess` path).

### Root cause

`setToolAccessForUserId` read a user's ENTIRE Clerk `publicMetadata` object
(`client.users.getUser(userId)`), spread it into a local copy, set/deleted `tool_access` on that
copy, then wrote the WHOLE copy back via `client.users.updateUserMetadata`:

```ts
const user = await client.users.getUser(userId);
const meta = { ...(user.publicMetadata as Record<string, unknown>) };
// ...set/delete meta.tool_access...
await client.users.updateUserMetadata(userId, { publicMetadata: meta });
```

Clerk's `updateUserMetadata` performs a server-side top-level MERGE of whatever keys are present
in the payload — a key present overwrites, `null` removes it, every other key is left untouched.
Two OTHER functions in this exact codebase already document relying on this specifically to avoid
a read-modify-write race:

- `updateClerkMembershipMetadata` (`src/lib/membership.ts`): *"Use updateUserMetadata (not
  updateUser) so Clerk performs a server-side deep-merge of publicMetadata rather than a full
  overwrite. This eliminates the read-modify-write race where two concurrent calls could each
  read stale metadata and overwrite each other's changes."*
- `setPersonalWebhook` (`src/lib/personal-alert-store.ts`): sends only
  `{ [PERSONAL_WEBHOOK_META_KEY]: value | null }`, never a full snapshot.

`setToolAccessForUserId` was the one place in the Clerk-metadata surface that didn't follow this
pattern: by reading the full object first and resending every key (including ones it had no
business touching), it reintroduced exactly the race those two sibling functions were written to
avoid. Any top-level field that changed concurrently between this function's `getUser` read and
its `updateUserMetadata` write (`tier`, `role`, `whop_user_id`, `whop_membership_id`,
`membership_kind`, `tier_managed_by`) got silently reverted to the stale value this function
re-sent, because that stale value was explicitly present in its merge payload — not because Clerk
failed to merge, but because the payload itself carried the wrong (stale) value for that key.

### Evidence

Reproduced with a fake Clerk client that models Clerk's own documented merge semantics (present
key overwrites, `null` removes, nothing else touched) and forces a real async gap inside `getUser`
so a concurrent "webhook" write can land in the window between this function's read and its write
— see `src/lib/tool-access-server-metadata-race.test.ts`.

- RED (pre-fix, via `git stash` on the fix alone): the old code's structure — reading the full
  object then writing it back — fails under the reproduction (the test's mocked Clerk client
  shows the concurrent `tier` change getting clobbered back to the stale pre-webhook value).
- GREEN (post-fix): a concurrent `tier`/`role` change made mid-flight by another caller survives
  a `setToolAccessForUserId` call, and the `tool_access` update itself still lands correctly
  (both the grant and the clear-to-empty path).

### Blast radius

Both call sites of `setToolAccessForUserId` are affected:

- `POST /api/admin/users/tools/bulk` — iterates up to 500 users per run (paged 100 at a time
  through Clerk's API), calling `setToolAccessForUserId` once per matching user. A real,
  non-trivial window during which a concurrent Whop webhook
  (`membership.activated`/`deactivated` → `updateClerkMembershipMetadata`) touching the SAME
  user's `tier` could have its change silently reverted by this function's stale resend.
- `PATCH /api/admin/users/[id]` (the `toolAccess` body field) — a single-user edit, smaller
  window but the same shape, and reachable concurrently with the bulk route or a webhook for the
  same user.

### Fix rationale

Stop doing the read-modify-write entirely rather than adding a lock: Clerk's API has no
transactional/locking primitive to take a lock against, and a lock would not even be the right
fix here — the actual problem is that the function was sending data it didn't need to send.
Compute the intended `tool_access` value and send ONLY that key (`null` to clear it), matching the
already-established pattern in `updateClerkMembershipMetadata` and `setPersonalWebhook`. This also
removes an unnecessary `client.users.getUser` round-trip per call (a secondary performance win,
not the primary motivation) and replaces the inline dynamic `import("@/lib/clerk-user-cache")`
with the module's existing static import (already imported for `getClerkUserCached`), since the
function no longer has any other reason to delay that import.

### Test

`src/lib/tool-access-server-metadata-race.test.ts` — two cases: a concurrent `tier` change
surviving a `tool_access` grant, and a concurrent `role` promotion surviving a `tool_access`
clear-to-inherit (empty map).
