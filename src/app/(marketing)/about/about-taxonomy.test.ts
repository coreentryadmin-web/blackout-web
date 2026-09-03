import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ABOUT = readFileSync(join(__dirname, "page.tsx"), "utf8");
const IOS_ROUTES = readFileSync(
  join(__dirname, "..", "..", "..", "lib", "ios-tool-routes.ts"),
  "utf8"
);

// Regression for a P2 finding (2026-09-03): About's product list described Night Hawk as an
// "Overnight playbook plus an intraday 0DTE scanner" — a stale, pre-rename description that got
// the emphasis backwards (0DTE Command is the always-on intraday RTH scanner; Evening Edition is
// the post-close prep artifact, not an "overnight playbook"). FAQ, /pricing, and the auth surface
// had already been corrected to the "0DTE Command + Evening Edition" model
// (`PRODUCT_MANIFEST.hawk`), leaving About as the one surface still drifted. The iOS app tile's
// short tagline carried the same stale framing and is fixed alongside it.
test("About's Night Hawk description matches the current 0DTE Command + Evening Edition taxonomy", () => {
  assert.doesNotMatch(
    ABOUT,
    /Overnight playbook/,
    "must not describe Night Hawk as an overnight-first product — 0DTE Command is the always-on intraday scanner"
  );
  assert.match(ABOUT, /0DTE Command/);
  assert.match(ABOUT, /Evening Edition/);
});

test("iOS Night Hawk tile tagline matches the current taxonomy, not the retired 'overnight playbook' framing", () => {
  assert.doesNotMatch(IOS_ROUTES, /"Overnight playbook"/);
});
