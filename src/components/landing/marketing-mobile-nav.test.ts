import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("marketing homepage exposes mobile nav menu for small viewports", () => {
  const nav = readFileSync(join(root, "src/components/landing/StaticMarketingNav.tsx"), "utf8");
  const mobile = readFileSync(join(root, "src/components/landing/MarketingMobileNav.tsx"), "utf8");
  const css = readFileSync(join(root, "src/app/marketing-shell.css"), "utf8");
  assert.match(nav, /MarketingMobileNav/);
  assert.match(mobile, /mkt-nav-menu-btn/);
  assert.match(mobile, /id="mkt-mobile-menu"/);
  assert.match(css, /\.mkt-mobile-menu\.is-open/);
});

test("mobile nav includes keyboard focus trap while open", () => {
  const mobile = readFileSync(join(root, "src/components/landing/MarketingMobileNav.tsx"), "utf8");
  assert.match(mobile, /e\.key !== "Tab"/);
  assert.match(mobile, /focusables/);
});

test("mobile nav preserves homepage hash fragments (Platform → #protocol)", () => {
  const mobile = readFileSync(join(root, "src/components/landing/MarketingMobileNav.tsx"), "utf8");
  const lib = readFileSync(join(root, "src/lib/marketing-hash-nav.ts"), "utf8");
  assert.match(mobile, /handleMarketingHomeHashClick/);
  assert.match(lib, /scrollIntoView/);
});

test("marketing shell includes scroll progress and anchor offset", () => {
  const shell = readFileSync(join(root, "src/components/landing/MarketingPageShell.tsx"), "utf8");
  const css = readFileSync(join(root, "src/app/marketing-shell.css"), "utf8");
  assert.match(shell, /MarketingScrollProgress/);
  assert.match(css, /scroll-padding-top/);
  assert.match(css, /scroll-margin-top/);
});
