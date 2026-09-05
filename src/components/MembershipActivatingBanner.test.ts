import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const bannerSrc = readFileSync(
  join(process.cwd(), "src/components/MembershipActivatingBanner.tsx"),
  "utf8"
);
const shellSrc = readFileSync(
  join(process.cwd(), "src/components/providers/AppShellProviders.tsx"),
  "utf8"
);

test("MembershipActivatingBanner polls membership sync after checkout return", () => {
  assert.match(bannerSrc, /fetch\("\/api\/membership\/sync"/);
  assert.match(bannerSrc, /readRememberedPlan/);
  assert.match(bannerSrc, /Activating membership/);
});

test("AppShellProviders mounts MembershipActivatingBanner globally", () => {
  assert.match(shellSrc, /MembershipActivatingBanner/);
});
