import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The Largo context rail is GONE — component, styles and the class toggle that gated it.
 *
 * It was a fully-built `<aside>` (spot, regime, level ladder, net flow, print count, Vector grade,
 * Night Hawk hits, degraded-state handling) with ~22 CSS rules including a mobile breakpoint, and
 * it was imported NOWHERE. `LargoTerminal` even applied a `largo-main-railed` class that had no
 * rule behind it. Someone built it, styled it, wired the layout hook, and never mounted it.
 *
 * VERIFIED ON PROD 2026-08-20 before removal: a live 1440x900 capture of a Deep dive answer found
 * ZERO blocks on the right half of the viewport — the answer is one full-width column. So this was
 * dead weight in the bundle and dead styles in the sheet, not a feature anyone could see.
 *
 * This test exists so it cannot creep back as unreferenced code: if someone re-adds the rail they
 * must also mount it, and this test tells them so.
 */

const root = process.cwd();
const CSS = readFileSync(join(root, "src/app/globals.css"), "utf8");
const TERMINAL = readFileSync(
  join(root, "src/features/largo/components/LargoTerminal.tsx"),
  "utf8"
);

test("the rail component file is gone", () => {
  assert.equal(
    existsSync(join(root, "src/features/largo/components/LargoContextRail.tsx")),
    false,
    "LargoContextRail.tsx must not exist"
  );
});

test("no rail styles survive in the stylesheet", () => {
  assert.doesNotMatch(CSS, /\.largo-rail/, "every .largo-rail* rule must be gone");
});

test("the dead class toggle is gone from the terminal", () => {
  // `largo-main-railed` was applied whenever a ticker resolved and had ZERO matching CSS — a
  // toggle switching on nothing.
  assert.doesNotMatch(TERMINAL, /largo-main-railed/);
  assert.doesNotMatch(CSS, /largo-main-railed/);
});

test("REGRESSION: the live transcript container is NOT collateral damage", () => {
  // `.largo-main` shared a mobile media query with `.largo-rail`. A block-level delete would have
  // taken it too, and the transcript is the thing the member actually reads. The removal was
  // written selector-by-selector for exactly this reason.
  assert.match(CSS, /\.largo-main\s*\{/, ".largo-main must survive");
  assert.match(TERMINAL, /className="largo-main"/, "and must still be applied");
});
