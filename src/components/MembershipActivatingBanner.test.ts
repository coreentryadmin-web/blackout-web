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

test("banner's z-index stays above .nav-bar's — nav is opaque from first paint on every non-home route", () => {
  // `.nav-bar` defaults `data-scrolled="true"` (Nav.tsx) on any route this banner can mount on
  // (it's never loaded on the marketing homepage), which makes `.nav-surface` fully opaque
  // immediately. If the banner's z-index ever drops to or below the nav's again, it is rendered
  // permanently invisible behind that opaque bar — exactly the bug this test guards against.
  const globalsSrc = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const navBarMatch = globalsSrc.match(/\.nav-bar\s*\{[^}]*z-\[(\d+)\]/s);
  assert.ok(navBarMatch, "could not find .nav-bar's z-index in globals.css — update this test's regex");
  const navZ = Number(navBarMatch[1]);

  const bannerMatch = bannerSrc.match(/z-\[(\d+)\]/);
  assert.ok(bannerMatch, "could not find the banner's z-index in MembershipActivatingBanner.tsx");
  const bannerZ = Number(bannerMatch[1]);

  assert.ok(
    bannerZ > navZ,
    `banner z-index (${bannerZ}) must stay above .nav-bar's (${navZ}) or the banner is invisible`
  );
});
