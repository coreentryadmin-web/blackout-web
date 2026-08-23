import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("site layout: iOS + route CSS deferred off global product shell", () => {
  const layout = read("src/app/(site)/layout.tsx");
  assert.doesNotMatch(layout, /ios-native\.css/);
  assert.doesNotMatch(layout, /nighthawk-v2\.css/);
  assert.doesNotMatch(layout, /admin-console\.css/);
  assert.match(layout, /IosNativeStylesLoader/);
});

test("nighthawk layout owns nighthawk-v2.css", () => {
  assert.match(read("src/app/(site)/nighthawk/layout.tsx"), /nighthawk-v2\.css/);
});

// Regression guard for the desktop tab-bar spacing bug (docs/audit/UI-UX-MAP.md §7, finding #8,
// 2026-08-23): NightHawkFeed.tsx renders <IosNativeSegment> unconditionally as its ONLY view
// switcher (0DTE/Swings/Bangers/Legacy), on desktop web too — unlike every other IosNativeSegment
// call site, which early-returns null off the native shell. The component's base flex/gap/padding/
// button-chrome CSS lives in ios-native-pages.css, which IosNativeStylesLoader deliberately never
// loads on desktop web (the test above confirms that boundary). Without those rules mirrored into
// nighthawk-v2.css (which IS always loaded for /nighthawk), the four tab labels render with zero
// layout — no gap, no button chrome — reading as one unbroken word. This test does not render the
// page; it asserts the structural CSS properties are present in the always-loaded file, so removing
// them (e.g. while "cleaning up" the color-only overrides this block started as) fails loud instead
// of silently reintroducing the bug.
test("nighthawk-v2.css: view-tab segment has its own structural CSS, not just color overrides", () => {
  const css = read("src/app/nighthawk-v2.css");
  const segmentBlock = css.match(/\.nh-v2-page \.ios-native-segment\s*\{[^}]*\}/)?.[0] ?? "";
  const btnBlock = css.match(/\.nh-v2-page \.ios-native-segment-btn\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(segmentBlock, /display:\s*flex/, "segment container must be a flex row");
  assert.match(segmentBlock, /gap:/, "segment container must space its buttons — this is the exact property whose absence produced the bug");
  assert.match(btnBlock, /flex:\s*1/, "each tab button must claim equal flex space, not collapse to content width");
});

test("admin layout owns admin-console.css", () => {
  assert.match(read("src/app/(site)/admin/layout.tsx"), /admin-console\.css/);
});

test("MotionProvider: snappy default transition + no tab-focus refetch storm", () => {
  const src = read("src/components/MotionProvider.tsx");
  assert.match(src, /revalidateOnFocus:\s*false/);
  assert.match(src, /dedupingInterval:\s*5000/);
  assert.match(src, /duration:\s*0\.18/);
});

test("MarketPulseLayer: aurora blur orbs disabled in CSS", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /\.market-pulse-aurora[\s\S]{0,80}display:\s*none/);
});

test("product-shell: desk routes freeze ambient loops before first paint", () => {
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /product-shell/);
  const css = read("src/app/globals.css");
  assert.match(css, /html\.product-shell body::before/);
  assert.match(css, /html\.product-shell \.market-pulse-wash/);
  assert.match(css, /html\.product-shell \.nav-mega/);
});

test("Nav: scroll chrome updates without React state", () => {
  const src = read("src/components/Nav.tsx");
  assert.doesNotMatch(src, /setScrolled/);
  assert.match(src, /applyNavSolid/);
});

// Regression guard for the Night Hawk header stat-strip "truncation" (docs/audit/UI-UX-MAP.md §7,
// finding #4, 2026-08-23): .nh-deck-hdr-row--primary is deliberately overflow-x:auto (its command-
// center modules routinely exceed the narrow left-rail's width — measured live at 672px of content
// in a 411px mobile rail), but mobile Safari hides the scrollbar `scrollbar-width:thin` requests, so
// there was nothing on screen indicating the last-visible module (often the "Updated ... sec ago"
// engine-status cell) could be scrolled into view — it just read as clipped mid-word. A live check
// confirmed the text was never lost (scrolling the row to its end fully revealed it), so the fix is
// a static right-edge fade signalling "there's more here", not a truncation/wrap change. Asserts the
// mask-image is present on the row so a future edit can't silently drop the affordance.
test("nh-deck-hdr-row--primary: has a right-edge scroll-affordance fade", () => {
  const css = read("src/app/globals.css");
  const block = css.match(/\.nh-deck-hdr-row--primary\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(block, /mask-image:\s*linear-gradient/, "must fade its right edge — the row scrolls but nothing else on mobile signals that");
});

// Regression guard for the Largo terminal toolbar "L…" collapse (docs/audit/UI-UX-MAP.md §8,
// finding #5, 2026-08-23): .largo-toolbar-actions is flex-shrink:0, so at narrow widths it always
// renders at its full content width and forces .largo-toolbar-brand (flex-shrink:1) down to almost
// nothing — measured live at 430x932: actions 344px of a 404px toolbar, brand's "Largo Terminal"
// squeezed to a 24.6px box against its own 119px content width, ellipsizing to "L…". The dominant
// contributor is .largo-answer-mode-toolbar (163.5px measured) — the only toolbar control that never
// got the icon-only mobile compaction every OTHER toolbar button already has via
// .largo-toolbar-btn-label{display:none}. Fix caps actions to 60% of the row and lets it scroll
// internally instead, giving the brand its guaranteed space — same trade-off as the nh-deck fix
// above. Asserts the cap + scroll are present in the narrow-viewport media query.
test("largo-toolbar-actions: capped and scrollable at narrow widths so the brand label isn't starved", () => {
  const css = read("src/app/globals.css");
  const blocks = [...css.matchAll(/\.largo-toolbar-actions\s*\{[^}]*\}/g)].map((m) => m[0]);
  assert.ok(blocks.length >= 2, "expected both the base rule and a narrow-viewport override for .largo-toolbar-actions");
  const capped = blocks.find((b) => /max-width:\s*60%/.test(b) && /overflow-x:\s*auto/.test(b));
  assert.ok(capped, "a .largo-toolbar-actions block must cap width and scroll — otherwise the brand is squeezed to near-zero at narrow widths");
});

// Regression guard for the Largo composer placeholder text bleeding past its input box
// (docs/audit/UI-UX-MAP.md §8, finding #5, 2026-08-23): the animated placeholder marquee is
// `will-change: transform` (GPU layer promotion) with a 36px-radius text-shadow glow, and that glow
// was rendering outside .largo-input-placeholder's own overflow:hidden clip on production (confirmed
// by a live screenshot at 430x932 — the pink glow text extended left of the composer's own border,
// into the page margin). overflow:hidden reliably clips a descendant's box but not always a
// composited layer's shadow — clip-path clips the actual paint regardless, so it's the fix.
test("largo-input-placeholder: clips the animated marquee's glow, not just its box", () => {
  const css = read("src/app/globals.css");
  const block = css.match(/\.largo-input-placeholder\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(block, /overflow:\s*hidden/, "keep the existing box clip");
  assert.match(block, /clip-path:\s*inset\(0\)/, "must also clip-path — overflow:hidden alone let the composited marquee's shadow paint outside the box on production");
});
