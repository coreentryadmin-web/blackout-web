import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DESK_NAV_LINKS } from "./desk-nav-links";

test("DESK_NAV_LINKS lists all 7 systems with a well-formed href/label/accent/sub", () => {
  assert.equal(DESK_NAV_LINKS.length, 7);
  const hrefs = DESK_NAV_LINKS.map((l) => l.href);
  assert.deepEqual(
    [...hrefs].sort(),
    ["/dashboard", "/flows", "/heatmap", "/nighthawk", "/terminal", "/vector", "/meridian"].sort()
  );
  for (const link of DESK_NAV_LINKS) {
    assert.ok(link.href.startsWith("/"), `${link.label} href must be a path`);
    assert.ok(link.label.length > 0, `${link.href} must have a label`);
    assert.ok(link.sub.length > 0, `${link.href} must have a sub description`);
    assert.match(link.accent, /^(green|purple|orange|blue|red|teal)$/);
  }
});

test("DRIFT GUARD: both Nav.tsx and DeskSidebar.tsx import DESK_NAV_LINKS instead of hand-copying their own list", () => {
  // DeskSidebar.tsx's own top-of-file comment used to claim it "reuses Nav's FEATURE_LINKS...
  // so the two navs can never drift" while the code directly below hand-copied the array —
  // true only by coincidence, since nothing enforced it. Both files now import the single
  // source in desk-nav-links.ts; this guard fails loudly if either ever reverts to a local copy.
  const navSrc = readFileSync(join(process.cwd(), "src/components/Nav.tsx"), "utf8");
  assert.match(
    navSrc,
    /import\s*\{\s*DESK_NAV_LINKS\s*\}\s*from\s*"@\/lib\/desk-nav-links"/,
    "Nav.tsx must import DESK_NAV_LINKS from @/lib/desk-nav-links"
  );
  assert.doesNotMatch(
    navSrc,
    /const FEATURE_LINKS[^=]*=\s*\[/,
    "Nav.tsx must not define its own FEATURE_LINKS array literal"
  );

  const sidebarSrc = readFileSync(join(process.cwd(), "src/components/DeskSidebar.tsx"), "utf8");
  assert.match(
    sidebarSrc,
    /import\s*\{\s*DESK_NAV_LINKS\s*\}\s*from\s*"@\/lib\/desk-nav-links"/,
    "DeskSidebar.tsx must import DESK_NAV_LINKS from @/lib/desk-nav-links"
  );
  assert.doesNotMatch(
    sidebarSrc,
    /const RAIL_LINKS[^=]*=\s*\[/,
    "DeskSidebar.tsx must not define its own RAIL_LINKS array literal"
  );
});
