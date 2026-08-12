import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const FOOTER_PATHS = [
  join(__dirname, "StaticLandingFooter.tsx"),
];
const APP_DIR = join(__dirname, "..", "..", "app");
const SITE_APP_DIR = join(APP_DIR, "(site)");
const MARKETING_APP_DIR = join(APP_DIR, "(marketing)");

function hasCatchAllRoute(dir: string): boolean {
  if (!existsSync(dir)) return false;
  return readdirSync(dir, { withFileTypes: true }).some(
    (entry) => entry.isDirectory() && entry.name.startsWith("[[...") && existsSync(join(dir, entry.name, "page.tsx"))
  );
}

function extractHrefs(source: string, arrayName: string): string[] {
  const arrayMatch = source.match(new RegExp(`const ${arrayName} = \\[([\\s\\S]*?)\\n\\];`));
  assert.ok(arrayMatch, `expected to find a "${arrayName}" array literal in footer source`);
  const body = arrayMatch[1];
  return [...body.matchAll(/href:\s*"(\/[^"]*)"/g)].map((m) => m[1]);
}

function routeExists(href: string): boolean {
  const path = href.split(/[?#]/)[0].replace(/^\//, "");
  if (path === "") {
    return existsSync(join(MARKETING_APP_DIR, "page.tsx")) || existsSync(join(SITE_APP_DIR, "page.tsx"));
  }
  if (existsSync(join(SITE_APP_DIR, path, "page.tsx"))) return true;
  if (existsSync(join(MARKETING_APP_DIR, path, "page.tsx"))) return true;
  return hasCatchAllRoute(join(APP_DIR, path)) || existsSync(join(APP_DIR, path, "page.tsx"));
}

test("StaticLandingFooter: DESK links all resolve to real routes", () => {
  for (const footerPath of FOOTER_PATHS) {
    const source = readFileSync(footerPath, "utf8");
    const hrefs = extractHrefs(source, "DESK");
    assert.ok(hrefs.length > 0, `expected DESK in ${footerPath}`);
    for (const href of hrefs) {
      assert.ok(routeExists(href), `${footerPath} DESK href "${href}" has no page.tsx`);
    }
  }
});

test("StaticLandingFooter: LEGAL links all resolve to real routes", () => {
  for (const footerPath of FOOTER_PATHS) {
    const source = readFileSync(footerPath, "utf8");
    const hrefs = extractHrefs(source, "LEGAL");
    assert.ok(hrefs.length > 0, `expected LEGAL in ${footerPath}`);
    for (const href of hrefs) {
      assert.ok(routeExists(href), `${footerPath} LEGAL href "${href}" has no page.tsx`);
    }
  }
});

test("StaticLandingFooter: never links to the removed /grid route", () => {
  for (const footerPath of FOOTER_PATHS) {
    const source = readFileSync(footerPath, "utf8");
    assert.doesNotMatch(source, /href:\s*"\/grid"/, `${footerPath} must not link to /grid`);
  }
});

test("StaticLandingFooter: no placeholder href=\"#\" links", () => {
  for (const footerPath of FOOTER_PATHS) {
    const source = readFileSync(footerPath, "utf8");
    assert.doesNotMatch(source, /href:\s*"#"/, `${footerPath} must not have placeholder href="#" links`);
  }
});

// Regression: /about had zero internal inbound links anywhere in the app (no footer,
// no nav — only its own self-referencing breadcrumb), so it sat "URL is unknown to
// Google" in Search Console for 6+ days despite being live and sitemap-submitted.
// Crawlers prioritize pages by following links, not by reading sitemap.xml alone —
// an unlinked page gets minimal crawl budget. Pin the footer link so a future
// refactor can't silently drop it back into orphan status.
test("StaticLandingFooter: DESK links to /about (was an orphan page with zero internal inlinks)", () => {
  for (const footerPath of FOOTER_PATHS) {
    const source = readFileSync(footerPath, "utf8");
    const hrefs = extractHrefs(source, "DESK");
    assert.ok(hrefs.includes("/about"), `${footerPath} DESK must link to /about`);
  }
});

test("StaticLandingFooter: DESK links to SEO lead-magnet and comparison pages", () => {
  for (const footerPath of FOOTER_PATHS) {
    const source = readFileSync(footerPath, "utf8");
    const hrefs = extractHrefs(source, "DESK");
    assert.ok(hrefs.includes("/tools/gamma-snapshot"), `${footerPath} DESK must link to free gamma tool`);
    assert.ok(hrefs.includes("/vs/others"), `${footerPath} DESK must link to comparison page`);
  }
});
