import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards a live visual bug (2026-09-07, desktop /nighthawk?view=swings, NRG 110C 11DTE): the
 * TradeHero metric row's "Current" value is dollar-formatted for swing plays (e.g. "+$4.80") and
 * rendered at the is-primary 22-28px font size (see the base rule below and the
 * `.nh-deck--swing-largo` 28px override elsewhere in this file). `.nh-deck-trade-hero__metric`
 * only has `min-width:0` on the flex column — that lets the COLUMN shrink, but does nothing to
 * clip a text node wider than it. Without overflow handling on the value span itself, a wide
 * dollar value paints straight past its grid column and visually overlaps the next metric's
 * value ("+$4.80" overlapping "Peak 98%" in the live repro) — illegible, not just visually noisy.
 */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

test(".nh-deck-trade-hero__metric .v clips overflow instead of bleeding into the next metric column", () => {
  // Negative lookbehind excludes the `.nh-deck--swing-largo .nh-deck-trade-hero__metric .v{...}`
  // scoped override (font-size/color only, earlier in the file) — a plain substring match without
  // it silently matches THAT rule instead, since it contains this selector as a tail.
  const m = css.match(/(?<!swing-largo )\.nh-deck-trade-hero__metric \.v\{([^}]*)\}/);
  assert.ok(m, "base .nh-deck-trade-hero__metric .v rule not found in globals.css");
  const decl = m![1];
  assert.match(decl, /overflow:hidden/, "must clip a too-wide value instead of letting it overflow");
  assert.match(decl, /text-overflow:ellipsis/, "must truncate visibly rather than hard-clipping mid-character");
  assert.match(decl, /white-space:nowrap/, "must stay single-line so ellipsis has an edge to truncate at");
});
