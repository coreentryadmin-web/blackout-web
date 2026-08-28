import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("VectorPageShell — native panel switcher on iOS", () => {
  const src = readFileSync(join(root, "src/features/vector/components/VectorPageShell.tsx"), "utf8");
  assert.match(src, /useIosNativeShell/);
  assert.match(src, /IosNativeSegment/);
  assert.match(src, /vector-ios-panel/);
  assert.match(src, /VECTOR_IOS_PANELS/);
  assert.match(src, /vector-page-shell-native/);
});

test("VectorTechnicalsPanel — honest-absence + reuses VectorPulse's intel-card markup", () => {
  const src = readFileSync(join(root, "src/features/vector/components/VectorTechnicalsPanel.tsx"), "utf8");
  assert.match(src, /if \(!technicals \|\| technicals\.length === 0\) return null;/);
  assert.match(src, /vp-intel-card/);
  assert.match(src, /renderEmphasis/);
});

test("VectorPageShell — iOS Plays segment mounts action rail on native shell", () => {
  const src = readFileSync(join(root, "src/features/vector/components/VectorPageShell.tsx"), "utf8");
  assert.match(src, /id: "plays", label: "Plays"/);
  assert.match(src, /iosPanel === "plays"/);
  assert.match(src, /VectorTickerComparisonStrip/);
  assert.doesNotMatch(src, /VectorTechnicalsPanel/);
});

test("VectorPageShell — desktop action rail (Play engine) available on web; iOS uses Plays segment", () => {
  const src = readFileSync(join(root, "src/features/vector/components/VectorPageShell.tsx"), "utf8");
  assert.match(src, /vector-action-rail/);
  assert.match(src, /iosPanel === "plays"/);
  assert.match(src, /VectorHelixRail/);
  assert.equal((src.match(/<VectorPlayCard/g) ?? []).length, 1);
  assert.doesNotMatch(src, /<VectorAlertsPanel\b/);
  assert.match(src, /<VectorAlertsBell\b/);
});

test("Vector route — no DeskShell double offset", () => {
  const page = readFileSync(join(root, "src/app/(site)/vector/page.tsx"), "utf8");
  assert.doesNotMatch(page, /DeskShell/);
  assert.match(page, /VectorPageClient/);
});

test("NightHawkFeed still adapts the view segment control for native shell (blurb removed entirely, not just hidden natively)", () => {
  const src = readFileSync(join(root, "src/features/nighthawk/components/NightHawkFeed.tsx"), "utf8");
  // The per-view descriptive blurb paragraph (NIGHTHAWK_VIEW_META[view].blurb) was removed
  // entirely from the page — not conditionally hidden on native shell — per the 2026-08-28
  // page-declutter direction (see NighthawkPageShell.tsx's own comment on the same change).
  assert.doesNotMatch(src, /NIGHTHAWK_VIEW_META\[view\]\.blurb/);
  assert.match(src, /variant=\{nativeShell \? "compact"/);
});

test("HELIX hides disclaimer on native shell", () => {
  const src = readFileSync(join(root, "src/features/helix/components/FlowFeed.tsx"), "utf8");
  assert.match(src, /!nativeShell &&/);
  assert.match(src, /helix-pro-disclaimer/);
  assert.match(src, /variant="compact"/);
});

test("AccountPageShell — native scroll wrapper", () => {
  const src = readFileSync(join(root, "src/components/account/AccountPageShell.tsx"), "utf8");
  assert.match(src, /ios-account-scroll/);
  assert.match(src, /useIosNativeShell/);
});

test("VectorPulse — feed curation (dedup + rate cap) wired into all three signal sources (2026-08-05)", () => {
  const src = readFileSync(join(root, "src/features/vector/components/VectorPulse.tsx"), "utf8");
  assert.match(src, /dedupeByKindLevel/);
  assert.match(src, /applyGlobalRateCap/);
  assert.match(src, /function curateAndEmit/);
  // All three emission sites (core detection, SPX play state, Helix flow prints) call the shared
  // curator rather than each duplicating its own ad hoc filterFreshPulseSignals + setFeed.
  assert.equal((src.match(/curateAndEmit\(/g) ?? []).length, 4); // 1 definition + 3 call sites
});
