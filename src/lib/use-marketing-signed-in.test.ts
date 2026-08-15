import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("marketing signed-in hook verifies session via /api/auth/me", () => {
  const hook = readFileSync(join(root, "src/lib/use-marketing-signed-in.ts"), "utf8");
  const nav = readFileSync(join(root, "src/components/landing/NavAuthLinks.tsx"), "utf8");
  assert.match(hook, /\/api\/auth\/me/);
  assert.match(hook, /data\.signedIn === false/);
  assert.match(nav, /useMarketingSignedIn/);
});
