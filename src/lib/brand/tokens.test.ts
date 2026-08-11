import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { C, GLYPH } from "./tokens";
import { fontCodepoints, missingCodepoints } from "./font-coverage";

const FONT_DIR = join(process.cwd(), "src/lib/brand/fonts");
const FACES = ["Anton-Regular.ttf", "JetBrainsMono-Regular.ttf", "JetBrainsMono-Bold.ttf"];

/**
 * GLYPH COVERAGE — the guard for a failure mode with no symptom.
 *
 * satori does not throw on a glyph its supplied buffers cannot draw; it downloads a Google font at
 * render time instead. So an uncovered character turns a local render into a network call, and
 * when that call fails the character just disappears. `GLYPH.none` was `◦` (U+25E6), absent from
 * all three faces, and every system-strip render had been making that request.
 */
test("every GLYPH codepoint exists in all three committed faces", () => {
  const all = Object.values(GLYPH).join("");
  for (const face of FACES) {
    const missing = missingCodepoints(join(FONT_DIR, face), all);
    assert.deepEqual(
      missing,
      [],
      `${face} cannot draw ${missing.map((c) => `U+${c.toString(16).toUpperCase()}`).join(", ")} — ` +
        `satori would fetch a Google font at render time for these`,
    );
  }
});

test("the cmap reader finds ordinary characters, so an empty result means absent not unread", () => {
  // Guards against the reader silently returning nothing and the coverage test passing vacuously.
  for (const face of FACES) {
    const cps = fontCodepoints(join(FONT_DIR, face));
    assert.ok(cps.size > 100, `${face} reported only ${cps.size} codepoints — reader is broken`);
    for (const ch of "ABC0129$%.,") {
      assert.ok(cps.has(ch.codePointAt(0)!), `${face} should contain ${ch}`);
    }
  }
});

test("the true minus sign renders — the formatters emit U+2212, not a hyphen", () => {
  // `fmtPct`/`fmtUsd` use U+2212. If a face lacked it, every negative number on every card would
  // trigger the same silent font fetch.
  for (const face of FACES) {
    assert.deepEqual(missingCodepoints(join(FONT_DIR, face), "−"), []);
  }
});

/**
 * PALETTE PARITY. `tokens.ts` duplicates the repo's colours as TS constants because satori cannot
 * read a stylesheet. A card that drifts from the desk's colour code is worse than one that never
 * matched: a member learns the code on the desk and applies it to the graphic.
 */
test("the palette still matches globals.css", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const cssVar = (name: string): string | null => {
    const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
    return m ? m[1]!.trim() : null;
  };
  const pairs: [string, string][] = [
    ["color-void", C.void],
    ["color-green", C.brand],
    ["largo-bull", C.bull],
    ["largo-bear", C.bear],
    ["largo-warn", C.warn],
    ["largo-ai", C.ai],
  ];
  for (const [name, expected] of pairs) {
    const actual = cssVar(name);
    assert.ok(actual, `--${name} not found in globals.css`);
    assert.equal(actual!.toLowerCase(), expected.toLowerCase(), `--${name} drifted from tokens.ts`);
  }
});
