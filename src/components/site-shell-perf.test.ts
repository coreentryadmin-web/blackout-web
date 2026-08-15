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

test("admin layout owns admin-console.css", () => {
  assert.match(read("src/app/(site)/admin/layout.tsx"), /admin-console\.css/);
});

test("MotionProvider: tab focus does not global-refetch all SWR hooks", () => {
  const src = read("src/components/MotionProvider.tsx");
  assert.match(src, /revalidateOnFocus:\s*false/);
  assert.match(src, /dedupingInterval:\s*5000/);
});

test("MarketPulseLayer: aurora blur orbs disabled in CSS", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /\.market-pulse-aurora[\s\S]{0,80}display:\s*none/);
});

test("Nav: scroll chrome updates without React state", () => {
  const src = read("src/components/Nav.tsx");
  assert.doesNotMatch(src, /setScrolled/);
  assert.match(src, /applyNavSolid/);
});
