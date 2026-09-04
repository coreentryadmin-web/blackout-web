import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function ruleBody(css: string, selector: string, label: string): string {
  const needle = `${selector} {`;
  const idx = css.indexOf(needle);
  assert.ok(idx >= 0, `${label}: selector "${selector}" not found in ios-native.css`);
  const open = idx + needle.length - 1;
  const close = css.indexOf("}", open);
  assert.ok(close > open, `${label}: no closing brace for "${selector}"`);
  return css.slice(open + 1, close);
}

const css = readFileSync(join(root, "src/app/ios-native.css"), "utf8");

test("command deck overlay drops pointer-events once nav-locked clears (exit animation)", () => {
  const exitRule = ruleBody(
    css,
    "html:not(.nav-locked) .ios-native-menu-overlay",
    "menu exit pointer guard"
  );
  assert.match(
    exitRule,
    /pointer-events:\s*none/,
    "exiting overlay must not block tab-bar taps while AnimatePresence unmounts"
  );
});

test("IosAppChrome still toggles nav-locked from menuOpen", () => {
  const tsx = readFileSync(join(root, "src/components/ios/IosAppChrome.tsx"), "utf8");
  assert.match(tsx, /classList\.toggle\("nav-locked", menuOpen\)/);
  assert.match(tsx, /setMenuOpen\(false\)/);
});
