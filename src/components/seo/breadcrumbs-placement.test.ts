import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Breadcrumbs must render INSIDE a page's content container, never as a bare sibling of
 * `MarketingPageShell`.
 *
 * `MarketingPageShell` renders `<main className="relative z-10">` with NO top padding — the space
 * that clears the fixed nav belongs to each page's own container (`.legal-page` has `padding: 6rem
 * 1rem 4rem`; the others use `py-20`). A `<Breadcrumbs>` placed before that container therefore
 * paints at y=0, underneath the header, in low-opacity text on a near-black background.
 *
 * That is what shipped on 12 marketing pages. Every HTML-level check passed the whole time — the
 * `<nav aria-label="Breadcrumb">` was present, the BreadcrumbList JSON-LD was valid — because none
 * of them can see stacking. It took a screenshot of production to catch, so this test encodes the
 * structural rule that the screenshot revealed.
 */

/**
 * Hand-rolled walk rather than `fs.globSync`. `globSync` landed in Node 22, and CI pins Node 20
 * (`.github/workflows/ci.yml` → `node-version: 20`) while this sandbox runs 22 — so the glob
 * version passed locally and threw `TypeError: globSync is not a function` in CI. `readdirSync`
 * with `withFileTypes` is available everywhere the repo supports.
 */
function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pageFiles(full));
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

const PAGES = pageFiles("src/app");

function stripped(src: string): string {
  // Drop the breadcrumb's own `items={[...]}` payload so nested JSX inside it can't be mistaken
  // for a container element.
  let out = src.replace(/<Breadcrumbs\s+items=\{\[[\s\S]*?\]\}\s*\/>/g, "<Breadcrumbs/>");
  // Handing the breadcrumb to a layout component as a prop — `breadcrumbs={<Breadcrumbs/>}`, the
  // way LegalPageLayout/WhyBlackoutContent/RedesignFaq take it — is the CORRECT fix: the component
  // renders it inside its own padded container. Remove those before looking for bare siblings, or
  // the fix itself trips the check.
  out = out.replace(/breadcrumbs=\{\s*<Breadcrumbs\/>\s*\}/g, "breadcrumbs={/*ok*/}");
  return out;
}

test("no page renders <Breadcrumbs> as a bare child of MarketingPageShell", () => {
  const offenders: string[] = [];
  for (const file of PAGES) {
    const raw = readFileSync(file, "utf8");
    if (!raw.includes("<Breadcrumbs") || !raw.includes("MarketingPageShell")) continue;
    const src = stripped(raw);
    const shell = src.indexOf("<MarketingPageShell");
    const bc = src.indexOf("<Breadcrumbs/>");
    if (shell === -1 || bc === -1) continue;

    // Between the shell and the breadcrumb there must be an opening container element. JSON-LD and
    // other self-closing metadata components do not count — they render nothing.
    const between = src.slice(src.indexOf(">", shell) + 1, bc);
    const opensContainer = /<(section|div|article|main)\b/.test(between);
    if (!opensContainer) offenders.push(file);
  }
  assert.deepEqual(
    offenders,
    [],
    "these pages render <Breadcrumbs> in MarketingPageShell's unpadded <main>, so it paints under " +
      "the fixed nav — pass it into the page's layout component (see LegalPageLayout's " +
      "`breadcrumbs` prop) or move it inside the content container"
  );
});

test("the breadcrumb trail is not rendered at a contrast level that reads as invisible", () => {
  // white/40 at 11px on the near-black marketing background was the shipped value and is well
  // under WCAG AA. This pins the floor rather than an exact value, so restyling stays possible.
  const src = readFileSync("src/components/seo/Breadcrumbs.tsx", "utf8");
  // Resting state only. `hover:text-white/70` is not a contrast floor — it requires a pointer, it
  // never applies on touch, and counting it let a revert of the base colour pass this test.
  const opacities = [...src.matchAll(/(?<!hover:)(?<!focus:)text-white\/(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(opacities.length > 0, "expected resting text-white/<n> classes in Breadcrumbs");
  const trail = Math.max(...opacities);
  assert.ok(
    trail >= 70,
    `breadcrumb resting text tops out at white/${trail}; the current-page crumb should sit at white/70+ ` +
      `(it shipped at white/40 for the trail, which is invisible on the marketing background)`
  );
});
