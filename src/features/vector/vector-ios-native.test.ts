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

test("VectorPageShell — desktop action rail (Play/Technicals) excluded from iOS native shell", () => {
  const src = readFileSync(join(root, "src/features/vector/components/VectorPageShell.tsx"), "utf8");
  assert.match(src, /vector-action-rail/);
  assert.match(src, /!\(compactPanels && nativeShell\)/);
  assert.match(src, /VectorTechnicalsPanel/);
  assert.match(src, /VectorHelixRail/);
  assert.equal((src.match(/<VectorPlayCard/g) ?? []).length, 1);
  // Alerts moved off the action rail entirely on 2026-08-27 (member: remove the standalone panel,
  // add a bell icon next to LIVE SESSION instead) — see VectorAlertsBell.test.ts. It is no longer
  // imported/mounted directly here at all, and its toolbar-anchored replacement is intentionally
  // NOT gated by the iOS-native action-rail exclusion above (it lives in the toolbar trailSlot,
  // which renders regardless of compactPanels/nativeShell — a member still needs alerts on iOS).
  assert.doesNotMatch(src, /<VectorAlertsPanel\b/);
  assert.match(src, /<VectorAlertsBell\b/);
});

test("Vector route — no DeskShell double offset", () => {
  const page = readFileSync(join(root, "src/app/(site)/vector/page.tsx"), "utf8");
  assert.doesNotMatch(page, /DeskShell/);
  assert.match(page, /VectorPageClient/);
});

test("NightHawkFeed hides view blurb on native shell", () => {
  const src = readFileSync(join(root, "src/features/nighthawk/components/NightHawkFeed.tsx"), "utf8");
  assert.match(src, /!nativeShell/);
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
