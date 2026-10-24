import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

/**
 * Regression coverage for a real Meridian-branding gap on the public /learn marketing pages
 * (found live 2026-09-23, screenshots via proxy-browser.cjs): Meridian is a real desk product
 * with its own dedicated "meridian-mark" ✦ sigil, already used consistently in the real app's
 * Nav.tsx and DeskSidebar.tsx (it has no entry in ProductMark.tsx's `MarkProduct` union, so it
 * can't use the shared animated-SVG sigil system the other six products use -- `meridian-mark`
 * is its own hand-styled substitute). `nav.ts` classifies Meridian as `product: "docs"` for lack
 * of a better bucket (it has no ProductMark sigil), which is accurate on its own -- but the three
 * /learn marketing-page components below only ever branched on `item.product === "docs"` and
 * never special-cased Meridian before falling into the generic docs-page treatment, so Meridian
 * inconsistently rendered as a bare "?" box (LearnSidebar), a bare "Abc" box (LearnHub), or no
 * icon at all (LearnSectionBlocks's tool-map/cross-links cards) -- never its own mark, unlike
 * every other real product on the same pages. Confirmed live: the Academy sidebar showed "?" for
 * Meridian and the /learn hub chapter grid showed "Abc" for Meridian, identical to the genuinely
 * docs-only "Getting Started"/"Glossary" chapters, while SPX Slayer/HELIX/Largo/Night
 * Hawk/Thermal/Vector all rendered their own colored animated sigil.
 */
test("LearnSidebar special-cases Meridian with the same meridian-mark sigil Nav.tsx/DeskSidebar.tsx use", () => {
  const src = readFileSync(join(root, "src/components/learn/LearnSidebar.tsx"), "utf8");
  assert.match(src, /item\.slug === "meridian"/);
  assert.match(src, /meridian-mark/);
});

test("LearnHub special-cases Meridian with the meridian-mark sigil instead of the generic docs box", () => {
  const src = readFileSync(join(root, "src/components/learn/LearnHub.tsx"), "utf8");
  assert.match(src, /guide\.slug === "meridian"/);
  assert.match(src, /meridian-mark/);
});

test("LearnSectionBlocks special-cases Meridian in both the tool-map and cross-links card renders", () => {
  const src = readFileSync(join(root, "src/components/learn/LearnSectionBlocks.tsx"), "utf8");
  const occurrences = src.match(/item\.slug === "meridian"/g) ?? [];
  assert.equal(occurrences.length, 2, "expected the meridian special case in both tool-map and cross-links");
  const markOccurrences = src.match(/meridian-mark/g) ?? [];
  assert.equal(markOccurrences.length, 2);
});

test("meridian-mark class is the same one already used live in Nav.tsx and DeskSidebar.tsx", () => {
  const nav = readFileSync(join(root, "src/components/Nav.tsx"), "utf8");
  const sidebar = readFileSync(join(root, "src/components/DeskSidebar.tsx"), "utf8");
  assert.match(nav, /meridian-mark/);
  assert.match(sidebar, /meridian-mark/);
});
