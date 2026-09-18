import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the Swing Command mobile list-width regression (live-verified via screenshot, forensic
 * batch 41, 2026-09-15): `.nh-deck--swing-largo .nh-deck-left{width:30%;min-width:220px}` (higher
 * specificity, unconditional) was winning the cascade over the base `.nh-deck-left{width:100%}`
 * mobile fix (@media max-width:820px), pinning the Swing list to ~min-width:220px on a phone
 * viewport and truncating STATUS/PLAY text into illegibility. Same cascade trap this file's own
 * `--nh-play-cols` override already documents and guards with `!important`.
 */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function indexOf(re: RegExp, label: string): number {
  const m = css.match(re);
  assert.ok(m && m.index != null, `${label} not found in globals.css`);
  return m.index;
}

test("swing-largo mobile list-width override exists, with !important, inside the @820px block", () => {
  const overrideIdx = indexOf(
    /@media \(max-width:820px\)\{\.nh-deck--swing-largo \.nh-deck-left\{width:100%!important;min-width:0!important\}\}/,
    "swing-largo mobile .nh-deck-left width override",
  );
  assert.ok(overrideIdx >= 0);
});

test("swing-largo mobile override is positioned AFTER the unconditional swing-largo width rule it corrects", () => {
  const unconditionalIdx = indexOf(
    /\.nh-deck--swing-largo \.nh-deck-left\{width:30%;min-width:220px\}/,
    "unconditional .nh-deck--swing-largo .nh-deck-left rule",
  );
  const overrideIdx = indexOf(
    /@media \(max-width:820px\)\{\.nh-deck--swing-largo \.nh-deck-left\{width:100%!important/,
    "swing-largo mobile override",
  );
  // Source order alone would NOT save the override (specificity decides ties regardless of order) —
  // this only documents that the fix follows the unconditional rule for readability; the
  // !important on both declarations is what actually makes the override win.
  assert.ok(unconditionalIdx < overrideIdx, "override should read naturally after the rule it corrects");
});

test("the unconditional swing-largo width rule has no !important of its own (would defeat the override)", () => {
  const m = css.match(/\.nh-deck--swing-largo \.nh-deck-left\{width:30%;min-width:220px\}/);
  assert.ok(m);
  assert.doesNotMatch(m[0], /!important/);
});
