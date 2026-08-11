import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deskLevel, DASH } from "./x-desk-card";

/**
 * The regression this file exists for is INVISIBLE at runtime: the card kept rendering, kept
 * posting, and kept looking plausible — in the wrong typeface — for its entire life, because
 * librsvg silently substitutes a fallback instead of erroring. Nothing threw, so nothing caught it.
 *
 * So the guard has to be structural: assert the file cannot go back to the librsvg path, and that
 * an absent level still refuses to invent a number. Rendering itself is not asserted here because
 * the repo's tsconfig is `jsx: "preserve"` and `tsx --test` cannot transform this file's JSX; the
 * render was verified by eye against real Anton glyphs when the change was made.
 */

const SRC = readFileSync(join(process.cwd(), "src/lib/x-desk-card.tsx"), "utf8");

test("renders through satori, never through sharp/librsvg", () => {
  // librsvg resolves fonts through fontconfig and ignores an @font-face data URI, so ANY return
  // to a `sharp(svgString)` render silently drops the brand face again.
  assert.ok(!/from "sharp"|require\("sharp"\)|import\("sharp"\)/.test(SRC), "must not import sharp");
  assert.ok(!/font-family=/.test(SRC), "must not hand-write SVG font-family attributes");
  assert.ok(SRC.includes("next/og"), "must rasterise via next/og (satori)");
});

test("uses the shared committed font buffers, not a second copy of the loader", () => {
  assert.ok(SRC.includes("loadVisualFonts"), "must call the shared loader");
  assert.ok(
    !/readFile\(.*\.ttf/.test(SRC),
    "must not read font files directly — that is how the two asset families drift apart",
  );
});

test("every PostType has a product label", () => {
  // Sourced from x-content-types so a new post type cannot ship with an unlabelled card.
  const types = readFileSync(join(process.cwd(), "src/lib/x-content-types.ts"), "utf8");
  const declared = [...types.matchAll(/"(desk_[a-z]+|weekend_desk)"/g)].map((m) => m[1]);
  assert.ok(declared.length > 0, "expected to find PostType members to check against");
  for (const t of new Set(declared)) {
    assert.ok(SRC.includes(`${t}:`), `PRODUCT_LABEL is missing ${t}`);
  }
});

test("an absent level renders the em dash, never a fabricated number", () => {
  assert.equal(deskLevel(null), DASH);
  assert.equal(deskLevel(undefined), DASH);
  assert.equal(deskLevel(NaN), DASH);
  assert.equal(deskLevel(Infinity), DASH);
});

test("a present level renders whole dollars with separators", () => {
  assert.equal(deskLevel(7772.94), "$7,773");
  assert.equal(deskLevel(7600), "$7,600");
  // Zero is a real value, not an absence — it must not collapse to the dash.
  assert.equal(deskLevel(0), "$0");
});
