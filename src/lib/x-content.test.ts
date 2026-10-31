// Regression guard for the X_ACCOUNT_USERNAME wiring-drift fix (findings-staging
// 2026-10-31): the constant must derive from SITE.social.x.handle rather than
// re-hardcoding the literal "BlackOutTrade" — that drift already happened once
// (#849 deleted the constant's only consumer; #915 then duplicated its value as
// a separate literal in site.ts instead of importing it).
//
// x-content.ts pulls in `server-only`-guarded provider modules transitively
// (anthropic.ts -> ... -> gex-positioning.ts), so it cannot be imported directly
// under the plain node:test runner used here (same reason cron-dispatch.test.ts
// above reads its source as text instead of importing it) — this test does the
// same: assert against the file's source text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = readFileSync(join(ROOT, "src/lib/x-content.ts"), "utf8");

test("X_ACCOUNT_USERNAME derives from SITE.social.x.handle, not a re-hardcoded literal", () => {
  assert.match(
    src,
    /export const X_ACCOUNT_USERNAME = SITE\.social\.x\.handle;/,
    "X_ACCOUNT_USERNAME must be wired to SITE.social.x.handle so the two can't drift apart again",
  );
  assert.match(
    src,
    /^import \{ SITE \} from "@\/lib\/site";/m,
    "x-content.ts must import SITE to back X_ACCOUNT_USERNAME",
  );
});

test("BRAND_VOICE references the account via X_ACCOUNT_USERNAME, not a hardcoded @BlackOutTrade literal", () => {
  const brandVoiceMatch = src.match(/const BRAND_VOICE = `([\s\S]*?)`;/);
  assert.ok(brandVoiceMatch, "expected to find the BRAND_VOICE template literal");
  const brandVoice = brandVoiceMatch![1];
  assert.doesNotMatch(
    brandVoice,
    /@BlackOutTrade/,
    "BRAND_VOICE should interpolate X_ACCOUNT_USERNAME instead of re-hardcoding the handle",
  );
  assert.match(brandVoice, /@\$\{X_ACCOUNT_USERNAME\}/);
});
