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

/**
 * Guards a second, sharper live visual bug found auditing the SAME tile (2026-09-19, desktop
 * /nighthawk?view=SWING, closed AAPL 332.5C 3DTE): the ellipsis above stops text from bleeding
 * into the next column, but it does not stop the "Current" tile's value from being clipped down
 * to nothing useful — a real -$0.85 P&L rendered as literal "$-0…", hiding the trader's own
 * number entirely (not "somewhat truncated", ZERO digits of the actual value visible). Live-
 * reproduced locally (Playwright, static extract of these exact rules, 500px hero width): "Current"
 * shared an even 1fr with 4 short percentage/rank/age tiles while rendering the ONLY
 * dollar-formatted value in the row, at the largest font in the row (22-28px vs 15-18px for the
 * others) — structurally guaranteed to run out of room first. Two independent guards:
 *  1. the metrics grid must give the primary (1st) column strictly more than an even 1/5 share,
 *     since it is structurally the longest value ("-$1,234.56" vs "+10%"/"#73 / 84");
 *  2. the swing-largo is-primary override must not push the font back up past the base
 *     22px size that this widened column was verified against (was 28px — the single largest
 *     contributor to the "$-0…" repro; see the local before/after PNGs referenced in the PR).
 */
test("nh-deck-trade-hero__metrics gives the dollar-formatted primary tile more than an even share, and swing-largo doesn't re-shrink that margin away", () => {
  const gridMatch = css.match(/\.nh-deck-trade-hero__metrics\{([^}]*)\}/);
  assert.ok(gridMatch, "nh-deck-trade-hero__metrics rule not found in globals.css");
  const gridDecl = gridMatch![1];
  const colsMatch = gridDecl.match(/grid-template-columns:([^;]+);/);
  assert.ok(colsMatch, "grid-template-columns not found on nh-deck-trade-hero__metrics");
  const firstTrack = colsMatch![1].trim().split(/\s+/)[0];
  const firstFrMatch = firstTrack.match(/([\d.]+)fr/);
  assert.ok(firstFrMatch, `first grid track must be an fr unit so it can be given extra share, got "${firstTrack}"`);
  assert.ok(
    Number(firstFrMatch![1]) > 1,
    `primary "Current" column must get MORE than the 1fr its 4 short siblings get (percentage/rank/age values are ` +
      `always shorter than a dollar-formatted P&L) — got ${firstFrMatch![1]}fr`,
  );

  const primaryOverrideMatch = css.match(/\.nh-deck--swing-largo \.nh-deck-trade-hero__metric\.is-primary \.v\{([^}]*)\}/);
  assert.ok(primaryOverrideMatch, "swing-largo is-primary .v override not found in globals.css");
  const fontSizeMatch = primaryOverrideMatch![1].match(/font-size:(\d+)px/);
  assert.ok(fontSizeMatch, "font-size not found on swing-largo is-primary .v override");
  assert.ok(
    Number(fontSizeMatch![1]) <= 22,
    `swing-largo primary tile font-size regressed back toward the 28px that produced the live "$-0…" ` +
      `repro — got ${fontSizeMatch![1]}px, expected <=22px (matches the base is-primary size)`,
  );
});

/**
 * Guards a THIRD live visual bug found on the SAME tile (2026-09-19, this time at PHONE width —
 * the #5257 fix above was only verified at desktop widths). Live-measured via proxy-browser.cjs at
 * 430x932: the primary "Current" value span rendered 74px wide but needed 112px for the plain,
 * non-extreme "+$0.00" — the shortest realistic dollar string this field produces — confirming the
 * desktop-verified 1.5fr/22px fix from #5257 is not enough ABSOLUTE room once the whole hero is
 * only ~400px wide to begin with, regardless of its improved relative share.
 */
test("a narrow-viewport (<=480px) media rule gives the primary tile even more room than the desktop #5257 fix, for both the plain and swing-largo variants", () => {
  const mobileBlockMatch = css.match(/@media \(max-width:480px\)\{([\s\S]*?)\n\}/);
  assert.ok(mobileBlockMatch, "no @media (max-width:480px) block found guarding the trade-hero primary tile");
  const block = mobileBlockMatch![1];

  const colsMatch = block.match(/\.nh-deck-trade-hero__metrics\{[^}]*grid-template-columns:([^;]+);/);
  assert.ok(colsMatch, "mobile block does not override nh-deck-trade-hero__metrics grid-template-columns");
  const firstTrack = colsMatch![1].trim().split(/\s+/)[0];
  const firstFrMatch = firstTrack.match(/([\d.]+)fr/);
  assert.ok(firstFrMatch, `mobile primary track must be an fr unit, got "${firstTrack}"`);
  assert.ok(
    Number(firstFrMatch![1]) > 1.5,
    `mobile primary column must get MORE relative share than the desktop #5257 fix's 1.5fr, since ` +
      `1.5fr already proved insufficient in absolute pixels at phone width — got ${firstFrMatch![1]}fr`,
  );

  // Both the plain and swing-largo-scoped is-primary .v rules must be re-capped inside the mobile
  // block — the swing-largo one is the selector that actually renders on /nighthawk?view=SWING, so
  // missing it here would leave the exact production repro unfixed while looking fixed.
  const plainFontMatch = block.match(/(?<!--swing-largo )\.nh-deck-trade-hero__metric\.is-primary \.v(?:,[\s\S]*?)?\{[^}]*font-size:(\d+)px/);
  assert.ok(plainFontMatch, "mobile block does not cap the plain is-primary .v font-size");
  assert.ok(Number(plainFontMatch![1]) < 22, `mobile primary font-size must be smaller than the desktop 22px, got ${plainFontMatch![1]}px`);

  const swingLargoFontMatch = block.match(/\.nh-deck--swing-largo \.nh-deck-trade-hero__metric\.is-primary \.v\{[^}]*font-size:(\d+)px/);
  assert.ok(swingLargoFontMatch, "mobile block does not cap the .nh-deck--swing-largo-scoped is-primary .v font-size");
  assert.ok(
    Number(swingLargoFontMatch![1]) < 22,
    `mobile swing-largo primary font-size must be smaller than the desktop 22px, got ${swingLargoFontMatch![1]}px`,
  );
});
