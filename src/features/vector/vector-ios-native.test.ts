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

test("Vector route — no DeskShell double offset", () => {
  const page = readFileSync(join(root, "src/app/(site)/vector/page.tsx"), "utf8");
  assert.doesNotMatch(page, /DeskShell/);
  assert.match(page, /VectorPageShell/);
});

test("NightHawkFeed — no per-view marketing blurb above the deck", () => {
  const src = readFileSync(join(root, "src/features/nighthawk/components/NightHawkFeed.tsx"), "utf8");
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
