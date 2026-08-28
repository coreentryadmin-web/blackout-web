import assert from "node:assert/strict";
import { test } from "node:test";
import { SITE } from "./site.ts";
import { LINKS } from "./x-intel/cta.ts";

// Regression guard for a real live bug (2026-08-28): SITE.social.discord.url and
// x-intel/cta.ts's own LINKS.discord carried two DIFFERENT Discord invite codes with no test
// tying them together. One (5zSt7G34dw) had gone dead — verified live against Discord's public
// invite-resolve API, which returned "Unknown Invite" (code 10006) — while every site surface
// (marketing footer, community rail, contact page, welcome-sequence email) kept serving that
// dead link to every visitor, free and paid alike, because nothing ever compared the two
// constants. A comment in cta.ts already flagged the divergence in 2026-08-21 but nothing
// enforced reconciling it. This test makes a future edit to either constant fail loudly instead
// of silently reintroducing the split.
test("the Discord invite is a single source of truth — site config and X-posting CTAs must agree", () => {
  assert.equal(
    SITE.social.discord.url,
    LINKS.discord,
    "SITE.social.discord.url (src/lib/site.ts) and LINKS.discord (src/lib/x-intel/cta.ts) must be the same invite — a silent split is how a dead link shipped everywhere but the X-posting module"
  );
});
