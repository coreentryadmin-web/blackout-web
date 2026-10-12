## 2026-10-12 — [Admin] CreateUserModal missing "community" tier option (EditUserModal has it) — FIXED
> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Admin console / UX gap | P3 — admin workaround exists (create-then-edit), no data integrity risk | FIXED |

**What's wrong.** `src/components/admin/UserManagement.tsx`'s `CreateUserModal` Tier `<select>`
(around line 804-812) offered only `free`/`premium`:
```tsx
<option value="free">free</option>
<option value="premium">premium</option>
```
while the near-identical `EditUserModal` Tier `<select>` (line 594-603) offers all three:
`free`, `community`, `premium`. The backend fully supports creating a user directly at
`"community"` tier — `POST /api/admin/users/create` (`route.ts:49,60,86`) calls
`parseTier(tier)`, which recognizes `"community"` (`src/lib/tiers.ts:9-13`) — so this was a pure
UI omission, not a backend limitation. An admin creating a manual SPX Slayer-tier account had to
create the user at `free`/`premium` first and then switch to the Edit modal to set `community` —
a copy-paste drift between two near-identical selects, not an intentional restriction.

**Fix.** Added the missing `<option value="community">community</option>` to CreateUserModal's
Tier select, matching EditUserModal exactly.

**Regression guard added.** New `src/components/admin/UserManagement.test.ts` (no test file
existed for this component before): scopes to each modal's own function body (`EditUserModal`
vs `CreateUserModal`, split at the next top-level `function` declaration) and asserts both offer
the same three tier options — source-text assertion, matching this repo's existing convention
for component-local constants without a render harness (see `AdminLaunchStatusPanel.test.ts`).
Verified RED→GREEN: reverting just the fix fails exactly on CreateUserModal (1 pass / 1 fail);
restoring it passes (2/2).

**Blast radius.** CreateUserModal's Tier select only. No change to EditUserModal or any backend
route. `tsc --noEmit` clean.

**Verification.**
```
npx tsx --experimental-test-module-mocks --test src/components/admin/UserManagement.test.ts
# 2 pass, 0 fail
```

Found via the same background Explore-agent sweep of the billing/account/admin surface that
found the `classifyAdminUserAccess` community-tier label gap (separate PR, same sweep) —
independently re-verified (both select blocks, the backend's `parseTier` support, and that no
test file existed for this component) before fixing.
