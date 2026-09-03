/**
 * Regression guard for the 2026-08-27 Suggested Play card redesign (member, verbatim: "I feel
 * like the layout UI UX of Vector plays is really bad — like really bad — and it is small, can we
 * make it bigger??"). Presentation-only: `vector-play-engine.ts` is untouched, every field
 * rendered here already existed on `VectorPlay` before this change.
 *
 * Does not render the component (no local render harness for this family — see
 * VectorChart-footer-labels.test.ts's precedent); asserts on source so a future edit can't
 * silently shrink the card back down or re-flatten the hierarchy this PR introduced.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const componentSrc = readFileSync(
  join(process.cwd(), "src/features/vector/components/VectorPlayCard.tsx"),
  "utf8"
);
const cssSrc = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function ruleBody(css: string, selector: string): string {
  // Anchor to line start to avoid matching compound selectors that reuse the class name.
  // Example: `.spx-vector-play-rail__signal .vector-play-card { ... }` should not match
  // when looking for `.vector-play-card`, only the standalone rule should match.
  const pattern = new RegExp(`^\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{`, 'm');
  const match = css.match(pattern);
  assert.ok(match, `expected a CSS rule for ${selector}`);
  const idx = match.index!;
  const close = css.indexOf("}", idx);
  return css.slice(idx, close);
}

test("VectorPlayCard: every field still comes straight from the untouched VectorPlay shape", () => {
  // Same data surface as before the redesign — grade, conviction, style, bias, headline, thesis,
  // entryZone, targets, invalidation, dataAge/STALE. No new engine field invented, none dropped.
  for (const field of [
    "play.grade",
    "play.conviction",
    "play.style",
    "play.bias",
    "play.headline",
    "play.thesis",
    "play.entryZone",
    "play.targets",
    "play.invalidation",
    "play.dataAge",
  ]) {
    assert.ok(componentSrc.includes(field), `expected ${field} to still be read`);
  }
  assert.match(componentSrc, /^import clsx from "clsx";$/m);
  assert.match(componentSrc, /STALE_MILD_MS, type VectorPlay \} from "@\/features\/vector\/lib\/vector-play-engine"/);
});

test("VectorPlayCard: grade + conviction are fused into one verdict badge (not two disconnected scraps)", () => {
  assert.match(componentSrc, /vector-play-card-badge-grade/);
  assert.match(componentSrc, /vector-play-card-badge-conviction/);
  // Both live inside the SAME badge wrapper element.
  const badgeBlock = componentSrc.slice(
    componentSrc.indexOf('className={clsx("vector-play-card-badge"'),
    componentSrc.indexOf("</span>\n        <div")
  );
  assert.match(badgeBlock, /vector-play-card-badge-grade/);
  assert.match(badgeBlock, /vector-play-card-badge-conviction/);
});

test("VectorPlayCard: entry/targets/invalidation stay a structured <dl>, not run-on prose", () => {
  assert.match(componentSrc, /<dl className="vector-play-card-levels">/);
  assert.match(componentSrc, /<dt>Entry<\/dt>/);
  assert.match(componentSrc, /<dt>Targets<\/dt>/);
  assert.match(componentSrc, /<dt>Invalidation<\/dt>/);
});

test("CSS: the card grew (bigger padding, radius, headline size) rather than only relabeling classes", () => {
  const card = ruleBody(cssSrc, ".vector-play-card");
  assert.match(card, /rounded-2xl/, "corner radius should read as a primary element, not a cramped chip (was rounded-xl)");
  assert.match(card, /px-4 py-3\.5/, "padding must be larger than the pre-redesign px-3 py-2.5");

  const headline = ruleBody(cssSrc, ".vector-play-card-headline");
  assert.match(headline, /text-\[17px\]/, "headline must be visibly larger than the thesis below it");
  assert.match(headline, /font-bold/, "headline is the card's lead — bold, not merely semibold");
});

test("CSS: targets and invalidation are color-coded (green exit target vs red/rose stop) so the levels grid reads without parsing the sentence", () => {
  const targets = ruleBody(cssSrc, ".vector-play-card-level-targets dd");
  assert.match(targets, /text-emerald-300/);
  const invalidation = ruleBody(cssSrc, ".vector-play-card-level-invalidation dd");
  assert.match(invalidation, /text-rose-300/);
});
