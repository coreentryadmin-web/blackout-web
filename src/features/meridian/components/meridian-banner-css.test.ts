import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE BANNER SUB IS TWO KINDS OF CONTENT, AND THE OLD RULE ONLY WORKED FOR ONE.
 *
 * `MeridianAnalyticsBanner`'s `sub` is a short VALUE readout on the Expected-move banner
 * ("126.39 - 134.21 (chain_iv)", 24 chars) and a full SENTENCE on the Play-read banner
 * ("If playing directionally, keep risk inside the ~3% options-implied band · king node…",
 * 86 chars). It carried `flex: none` (cannot shrink) and `white-space: nowrap` (cannot wrap), so
 * the long one stayed rigid at max-content width and the BODY absorbed all the shrinkage.
 *
 * Measured live on prod, desktop 1440, Positioning tab:
 *
 *   Play read      bannerW 1005   bodyW   0   headlineLines 7   sub 1031px  ->  96px past the box
 *   Expected move  bannerW 1005   bodyW 640   headlineLines 1   sub  294px  ->  fits
 *
 * `bodyW: 0` is the label and headline squeezed out of existence — "PLAY READ" and "Imminent
 * print" printed one word per line down a sliver while the sentence ran under `overflow: hidden`
 * and was cut mid-word.
 *
 * Asserted from the CSS because there is nothing else to assert it from: the component renders
 * three plain elements and every property that matters lives in the stylesheet, so a type check
 * and a render test both pass on the broken version. Same approach as the ladder row-height guard.
 */
// Comments stripped up front: a `/* … */` sitting between a `;` and the next declaration would
// otherwise hide that declaration from the property scan below.
const css = readFileSync(join(process.cwd(), "src/app/desk-app.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

/**
 * The LAST declaration of `prop` across every rule for `selector` — i.e. what the cascade lands
 * on. Property-aware rather than "the last rule", because the last rule for this selector is the
 * <=640px override, which declares only `text-align` and `font-size`; reading it would report
 * `flex` and `white-space` as absent no matter what the base rule says.
 */
function declaredValue(selector: string, prop: string): string | null {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rules = [...css.matchAll(new RegExp(`(^|[,\\s}])${esc}\\s*\\{([^}]*)\\}`, "g"))].map((m) => m[2]!);
  assert.ok(rules.length, `no rule found for ${selector}`);
  let found: string | null = null;
  for (const body of rules) {
    const m = [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "g"))].pop();
    if (m) found = m[1]!.trim();
  }
  return found;
}

test("the banner sub can SHRINK — `flex: none` is what pinned it at max-content width", () => {
  const flex = declaredValue(".meridian-analytics-banner-sub", "flex");
  assert.notEqual(flex, "none", "`flex: none` returns the sub to a rigid box that forces the body to 0");
  assert.match(String(flex), /0\s+1\s+auto/, "the sub must be allowed to shrink");
  assert.equal(
    declaredValue(".meridian-analytics-banner-sub", "min-width"),
    "0",
    "without min-width:0 a flex item cannot shrink past its min-content width"
  );
});

test("the banner sub can WRAP — `white-space: nowrap` is what forced the overflow", () => {
  const ws = declaredValue(".meridian-analytics-banner-sub", "white-space");
  assert.notEqual(ws, "nowrap", "a sentence-length sub cannot be nowrap; it runs under overflow:hidden");
  assert.equal(ws, "normal");
  // Breaking INSIDE a word would split "126.39" across lines on the value-readout banner — a
  // different defect. Wrapping at spaces is the whole fix.
  assert.notEqual(
    declaredValue(".meridian-analytics-banner-sub", "overflow-wrap"),
    "anywhere",
    "wrap at spaces only — anywhere would split a numeric readout mid-number"
  );
});

test("the wrap is unconditional, not gated on a phone breakpoint", () => {
  // The 640px media query already described this exact failure — "the value wraps under rather
  // than squeezing the headline to nothing" — but gated the cure on VIEWPORT WIDTH. The trigger
  // is the sub being longer than the room beside the headline, which happens at 1440px too.
  assert.equal(
    declaredValue(".meridian-analytics-banner", "flex-wrap"),
    "wrap",
    "flex-wrap must apply at every width, not only <=640px"
  );
});

test("the body keeps a floor so the label and headline cannot collapse to nothing", () => {
  assert.match(
    String(declaredValue(".meridian-analytics-banner-body", "flex")),
    /^1\s+1\s+\d+(?:\.\d+)?rem$/,
    "a bare `auto` basis let the body shrink to 0 and wrap the headline one word per line"
  );
});
