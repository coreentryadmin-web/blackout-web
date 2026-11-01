import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(import.meta.dirname, "UserManagement.tsx"),
  "utf8"
);

/**
 * Guards against the Tier <select> in CreateUserModal drifting out of sync with the one in
 * EditUserModal. Found live 2026-10-12: CreateUserModal offered only free/premium while
 * EditUserModal (and the backend's parseTier, which fully supports it) offered free/community/
 * premium — forcing admins to create-then-edit for any SPX Slayer-tier manual account. Source-
 * text assertion, scoped to each component's own body, rather than a render test — this repo's
 * existing convention for this file (no render harness here) and for component-local constants
 * generally (see AdminLaunchStatusPanel.test.ts).
 */
function componentBody(name: string): string {
  const start = SRC.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in UserManagement.tsx`);
  // Next top-level `function ` after this one marks the end of this component's body.
  const nextFn = SRC.indexOf("\nfunction ", start + 1);
  return nextFn >= 0 ? SRC.slice(start, nextFn) : SRC.slice(start);
}

test("EditUserModal's Tier select offers free/community/premium", () => {
  const body = componentBody("EditUserModal");
  for (const tier of ["free", "community", "premium"]) {
    assert.match(body, new RegExp(`<option value="${tier}">${tier}</option>`));
  }
});

test("CreateUserModal's Tier select offers the same tiers as EditUserModal", () => {
  const body = componentBody("CreateUserModal");
  for (const tier of ["free", "community", "premium"]) {
    assert.match(
      body,
      new RegExp(`<option value="${tier}">${tier}</option>`),
      `CreateUserModal is missing the "${tier}" tier option`
    );
  }
});

// Regression for 2026-10-12: the "Access type" filter's "community" option read "Community
// (Discord)", but "community" is the paid SPX Slayer ($49) tier (TIER_LABELS.community in
// src/lib/tiers.ts, admin-user-access.ts's own accessSummary: "SPX Slayer ($49) — SPX desk only")
// — Discord is an unrelated free perk. AdminToolsPanel.tsx's own "community" filter option
// already labels it correctly ("SPX Slayer ($49)"); this asserts UserManagement's never drifts
// back to conflating the two again.
test("UserManagement's 'community' access-type filter does not conflate the paid SPX Slayer tier with Discord", () => {
  assert.doesNotMatch(SRC, /community.*Discord/is);
  assert.match(SRC, /{ value: "community", label: "Community \(SPX Slayer\)" }/);
});

// Regression (2026-10-20, DISCOVERY-lane accessibility sweep): EditUserModal and
// CreateUserModal each rendered a visible <label> as a SIBLING of its <input>/<select> with
// no htmlFor/id link — a screen reader gets no accessible name on focus despite the label
// text being right there visually. Repeated across both modals (First/Last name, Tier,
// Role), plus the read-only sign-in-link input (no label element at all, only a preceding
// <p>) and the Create-user modal's Email/Phone fields. Fixed by adding matching id/htmlFor
// pairs (and aria-label on the sign-in-link input, which has no dedicated <label>).
const EDIT_USER_FIELD_IDS = [
  ["edit-user-first-name", "First name"],
  ["edit-user-last-name", "Last name"],
  ["edit-user-tier", "Tier"],
  ["edit-user-role", "Role"],
] as const;

const CREATE_USER_FIELD_IDS = [
  ["create-user-email", "Email *"],
  ["create-user-phone", "Phone *"],
  ["create-user-first-name", "First name"],
  ["create-user-last-name", "Last name"],
  ["create-user-tier", "Tier"],
  ["create-user-role", "Role"],
] as const;

test("EditUserModal's fields each have a label associated via htmlFor/id", () => {
  const body = componentBody("EditUserModal");
  for (const [id, labelText] of EDIT_USER_FIELD_IDS) {
    assert.match(
      body,
      new RegExp(`htmlFor="${id}"[^>]*>${labelText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      `expected a <label htmlFor="${id}"> for "${labelText}"`
    );
    assert.match(body, new RegExp(`id="${id}"`), `expected a control with id="${id}"`);
  }
});

test("CreateUserModal's fields each have a label associated via htmlFor/id", () => {
  const body = componentBody("CreateUserModal");
  for (const [id, labelText] of CREATE_USER_FIELD_IDS) {
    assert.match(
      body,
      new RegExp(`htmlFor="${id}"[^>]*>${labelText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      `expected a <label htmlFor="${id}"> for "${labelText}"`
    );
    assert.match(body, new RegExp(`id="${id}"`), `expected a control with id="${id}"`);
  }
});

test("EditUserModal's read-only sign-in-link input carries an aria-label", () => {
  const body = componentBody("EditUserModal");
  const inputStart = body.indexOf("One-time sign-in link (15 min)");
  assert.ok(inputStart > 0, "expected the sign-in-link block to still exist");
  const inputBlock = body.slice(inputStart, inputStart + 300);
  assert.match(
    inputBlock,
    /aria-label="One-time sign-in link"/,
    "the sign-in-link input has no <label> element — it must carry an aria-label"
  );
});

// Regression (DISCOVERY-lane sweep, round 245): `openUserDetail` used to be a bare
// `fetch(...).then(setSelectedUser)` with no race guard at all. The "Edit" button has no
// per-row loading/disabled state, so clicking two different user rows in quick succession (or
// double-clicking the same row before the first request resolves) fires two overlapping
// `GET /api/admin/users/:id` requests with nothing stopping the EARLIER one from resolving
// AFTER the LATER one and overwriting `selectedUser` with the wrong user's data — and
// `onDelete={() => setDeleteConfirm(selectedUser)}` seeds the ban/delete confirm modals
// straight from `selectedUser`, so a stale overwrite risks an admin banning or deleting the
// wrong account while believing the drawer reflects the row they most recently clicked. Same
// shape already fixed in `AdminApiEventDetail.tsx` (#6926) and reused here via this file's own
// `runGuardedUsersFetch` (already wired into `fetchUsers` for the un-debounced search box, but
// — until this fix — not into `openUserDetail`). No render harness for this file (see the
// header comment above), so this asserts the actual wiring via source text: that `openUserDetail`
// bumps its OWN request-id ref (distinct from the list fetch's `latestUsersRequestIdRef`) and
// routes its fetch through the shared guard rather than applying the response unconditionally.
test("openUserDetail guards against an out-of-order stale response via runGuardedUsersFetch", () => {
  const body = componentBody("UserManagement");
  const fnStart = body.indexOf("const openUserDetail = async (userId: string) => {");
  assert.ok(fnStart >= 0, "openUserDetail not found in UserManagement.tsx");
  const fnEnd = body.indexOf("\n  };", fnStart);
  const fnBody = body.slice(fnStart, fnEnd >= 0 ? fnEnd : fnStart + 600);

  assert.match(
    fnBody,
    /runGuardedUsersFetch\(/,
    "openUserDetail must route its fetch through runGuardedUsersFetch, not apply the response unconditionally"
  );
  assert.match(
    fnBody,
    /latestUserDetailRequestIdRef\.current/,
    "openUserDetail must bump/read its own request-id ref — reusing latestUsersRequestIdRef " +
      "would make an ordinary list refetch spuriously drop an in-flight detail fetch"
  );
  // Must NOT be the dedicated list-fetch ref — that would silently defeat the guard by having
  // openUserDetail watch a counter it never bumps (or that an unrelated list refetch bumps).
  assert.doesNotMatch(
    fnBody,
    /latestUsersRequestIdRef/,
    "openUserDetail must not reuse the list-fetch's request-id ref"
  );
});
