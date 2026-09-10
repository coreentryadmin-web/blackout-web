import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Companion to the equivalent guards for `GUIDE_SEO` (`guide-seo.test.ts`) and `LEARN_ARTICLES`
 * (`articles.test.ts`) — those cover the Learn hub's content objects, but nothing checked the
 * standalone marketing `page.tsx` files (homepage, /about, /vs/others, /methodology, /privacy,
 * etc.), which set their `metaDescription` as a literal argument to `publicPageMetadata()`
 * directly in the route file rather than through a shared content object.
 *
 * Found live 2026-09-10: 5 of these pages exceeded Google's ~155-160 char SERP truncation limit —
 * the homepage at 167 chars and `/vs/others` at 215 (worst, cutting off mid-sentence) — with
 * nothing anywhere in the suite that would have caught it. This scans every `page.tsx` under
 * `(marketing)` for a literal `publicPageMetadata("title", "description", ...)` call (resolving a
 * same-file `const NAME = "...";` when the argument is a bare identifier) and enforces the same
 * 160-char ceiling the other two guards already use.
 *
 * Two routes are deliberately out of scope, not silently skipped:
 * - `research/gamma-levels/page.tsx` and its `[ticker]` route both serve `noindex, nofollow`
 *   (confirmed live) per the licensing posture in `docs/marketing/RESEARCH-PUBLISH-POSTURE.md` — a
 *   truncated SERP snippet is not a real problem on a page Google never indexes.
 * - `learn/[slug]/page.tsx` builds its metadata from `GUIDE_SEO`/`LEARN_ARTICLES` at request time,
 *   already covered by the two companion guards named above.
 * A description built from a template literal with an interpolated expression (e.g. `pricing`'s
 * `${manifestProductCountWord()}`) can't be resolved statically and is reported separately rather
 * than silently ignored, so a genuinely long dynamic description doesn't go unnoticed forever.
 */

const MARKETING_ROOT = "src/app/(marketing)";
const EXCLUDED_ROUTES = new Set([
  "research/gamma-levels/page.tsx",
  "research/gamma-levels/[ticker]/page.tsx",
  "learn/[slug]/page.tsx",
]);
const MAX_LEN = 160;

function findPageFiles(dir: string, root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...findPageFiles(full, root));
    } else if (entry === "page.tsx") {
      out.push(full.slice(root.length + 1));
    }
  }
  return out;
}

function resolveStringArg(src: string, arg: string): string | undefined {
  const literal = arg.match(/^["'`](.*)["'`]$/s);
  if (literal) return literal[1];

  // Bare identifier — look for a same-file `const NAME = "...";` (single string literal only;
  // a template literal containing `${...}` is left unresolved rather than guessed at).
  const constMatch = new RegExp(`const\\s+${arg}\\s*=\\s*["'\`]([\\s\\S]*?)["'\`]\\s*;`).exec(src);
  if (constMatch && !constMatch[1].includes("${")) return constMatch[1];
  return undefined;
}

test("no standalone marketing page's meta description exceeds 160 characters", () => {
  const files = findPageFiles(MARKETING_ROOT, MARKETING_ROOT).filter((f) => !EXCLUDED_ROUTES.has(f));

  const violations: string[] = [];
  const unresolved: string[] = [];
  let checked = 0;

  for (const file of files) {
    const src = readFileSync(join(MARKETING_ROOT, file), "utf8");
    // A quoted string arg (handling escaped quotes) or a bare identifier — NOT `[^,]+`, which
    // stops at the first comma INSIDE a description like "collects, uses, and protects...".
    const STRING_OR_IDENT = `("(?:[^"\\\\]|\\\\.)*"|\`(?:[^\`\\\\]|\\\\.)*\`|[A-Za-z_$][\\w$]*)`;
    const call = new RegExp(`publicPageMetadata\\(\\s*${STRING_OR_IDENT}\\s*,\\s*${STRING_OR_IDENT}\\s*,`).exec(
      src,
    );
    if (!call) continue; // no static publicPageMetadata(...) call in this route

    const description = resolveStringArg(src, call[2].trim());
    if (description === undefined) {
      unresolved.push(file);
      continue;
    }
    checked++;
    if (description.length > MAX_LEN) {
      violations.push(`${file}: ${description.length} chars`);
    }
  }

  assert.ok(checked >= 10, `expected to statically check at least 10 marketing pages, got ${checked}`);
  assert.equal(
    violations.length,
    0,
    `marketing pages with metaDescription over ${MAX_LEN} chars (will truncate in SERPs):\n  ${violations.join("\n  ")}`,
  );
  // Not a failure — dynamic descriptions (e.g. pricing's product-count interpolation) can't be
  // statically measured. Surfaced so a genuinely long one doesn't go unnoticed forever.
  if (unresolved.length > 0) {
    console.log(`[info] could not statically resolve metaDescription for: ${unresolved.join(", ")}`);
  }
});
