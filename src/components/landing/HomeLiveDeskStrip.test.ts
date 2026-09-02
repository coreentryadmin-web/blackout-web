import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("home live desk strip keeps the page's shared 1.5rem side margin", () => {
  // HomeLiveDeskStrip renders its row as <div className="w home-live-strip-inner">, combining
  // the shared `.w` class (max-width + centering + `padding:0 1.5rem`, used by every other
  // section on the homepage) with its own `.home-live-strip-inner` class. `.rl
  // .home-live-strip-inner` is more specific than `.w`, so its own `padding` shorthand fully
  // overrides all four sides rather than layering on top — a bare `padding:.65rem 0` here
  // silently zeroes the 1.5rem horizontal margin `.w` was added for, making the row (the "GEX
  // snapshot initializing" chip and the product-link ticker beneath it) run edge-to-edge while
  // every sibling section on the page keeps its 1.5rem side padding. Confirmed live on prod
  // mobile (430px viewport): the row's text sits flush at x=0, unlike the rest of the hero.
  const css = readFileSync(join(root, "src/app/marketing-redesign.css"), "utf8");
  const rule = css.match(/\.rl \.home-live-strip-inner\{([^}]*)\}/);
  assert.ok(rule, "expected a .rl .home-live-strip-inner rule in marketing-redesign.css");
  const padding = rule![1].match(/padding:([^;]+);/);
  assert.ok(padding, "expected a padding declaration on .rl .home-live-strip-inner");
  assert.equal(
    padding![1].trim(),
    ".65rem 1.5rem",
    "the horizontal component must restate .w's 1.5rem side padding, not zero it out"
  );
});
