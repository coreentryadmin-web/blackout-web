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
