import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Guards #3119 — media-query rules lose to later equal-specificity base rules unless ordered/!important. */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function indexOf(re: RegExp, label: string): number {
  const m = css.match(re);
  assert.ok(m && m.index != null, `${label} not found in globals.css`);
  return m.index;
}

/** The nh-deck phone block — not the earlier `.nh-deck-search` @820px rule elsewhere in this file. */
const mobileDeckStart = indexOf(
  /\/\* Mobile stacked layout \(member report 2026-08-29/,
  "nh-deck mobile stacked layout comment",
);
const mobileDeckCss = css.slice(mobileDeckStart, mobileDeckStart + 5000);

test("mobile back button base hide precedes mobile inline-flex (cascade order)", () => {
  const baseHide = indexOf(/\.nh-deck-mobile-back\{display:none/, "base .nh-deck-mobile-back hide");
  const mobileBlock = mobileDeckCss.indexOf("@media (max-width:820px)");
  assert.match(mobileDeckCss, /\.nh-deck-mobile-back\{display:inline-flex/);
  assert.ok(mobileBlock >= 0, "nh-deck mobile media block missing");
  assert.ok(baseHide < mobileDeckStart + mobileBlock, "base hide must precede the nh-deck mobile block");
});

test("mobile play grid narrows cols and hides grade/time with !important", () => {
  assert.match(
    mobileDeckCss,
    /\.nh-deck-play-table\{--nh-play-cols:20px 56px minmax\(0,1fr\) 64px!important\}/,
  );
  assert.match(
    mobileDeckCss,
    /\.nh-deck-play-cell--rating,\.nh-deck-play-cell--time\{display:none!important\}/,
  );
});

test("mobile detail rail is a fixed overlay — list is never display:none swapped out", () => {
  assert.match(mobileDeckCss, /\.nh-deck-right\{[\s\S]*position:fixed/);
  assert.match(mobileDeckCss, /transform:translateY\(100%\)/);
  assert.match(
    mobileDeckCss,
    /\.nh-deck\[data-mobile-view="detail"\] \.nh-deck-right\{transform:translateY\(0\)/,
  );
  assert.doesNotMatch(mobileDeckCss, /\.nh-deck-left\{display:none/);
  assert.doesNotMatch(mobileDeckCss, /\.nh-deck-right\{display:none/);
});
