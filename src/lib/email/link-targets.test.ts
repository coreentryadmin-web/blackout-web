import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getArticle } from "@/lib/learn/articles";
import { isLearnGuideSlug } from "@/lib/learn/guide-seo";

/**
 * Every first-party link in an email must point at a route that actually exists.
 *
 * Three lifecycle emails — payment-failed, scheduled-cancel, downgrade — shipped with CTAs
 * pointing at `/account/billing`, a route this app has never had. Billing is handled entirely by
 * Whop; `/account` (via AccountMembershipPanel) is the page that says so and links onward to the
 * portal. A member whose card was declined clicked "Update Payment Method" and got a 404.
 *
 * It survived a manual link sweep because an anonymous probe cannot see it: `/account/*` is
 * behind the Clerk matcher, so a signed-out request to `/account/billing` returns **307** to
 * sign-in — indistinguishable from a healthy protected route. The 404 only appears once you are
 * signed in, which is exactly the state a real recipient is in and a curl check is not. So this
 * test resolves links against the App Router source rather than over HTTP: no auth, no
 * environment, no false green from a redirect.
 */

const TEMPLATE_DIR = "src/lib/email/templates";
const APP_DIR = "src/app";

/** Collect every `${SITE.url}/path` referenced by any template. */
function emailPaths(): { file: string; path: string }[] {
  const out: { file: string; path: string }[] = [];
  for (const file of readdirSync(TEMPLATE_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const src = readFileSync(join(TEMPLATE_DIR, file), "utf8");
    for (const m of src.matchAll(/\$\{SITE\.url\}(\/[a-zA-Z0-9/_-]*)/g)) {
      const path = m[1].replace(/\/$/, "");
      if (path) out.push({ file, path });
    }
  }
  return out;
}

/**
 * True when a `page.tsx` serves this URL path.
 *
 * Two App Router conventions have to be modelled or the answer is wrong in both directions:
 * route groups — `(site)`, `(marketing)` — are directories that do NOT appear in the URL, and
 * dynamic segments — `[slug]` — match any single segment. Ignoring groups misses every real
 * route; ignoring dynamic segments falsely condemns `/learn/gamma-flip-explained`, which is
 * served by `learn/[slug]/page.tsx`. Catch-alls (`[...x]`) match one-or-more segments.
 */
function routeExists(urlPath: string): boolean {
  const want = urlPath.replace(/^\//, "").split("/").filter(Boolean);
  let found = false;
  const walk = (dir: string, depth: number) => {
    if (found) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (found) return;
      if (e.isDirectory()) {
        const isGroup = e.name.startsWith("(") || e.name.startsWith("@");
        if (isGroup) {
          walk(join(dir, e.name), depth); // contributes nothing to the URL
          continue;
        }
        const isOptionalCatchAll = /^\[\[\.\.\..+\]\]$/.test(e.name);
        const isCatchAll = /^\[\.\.\..+\]$/.test(e.name);
        const isDynamic = /^\[[^[\].]+\]$/.test(e.name);
        if (isOptionalCatchAll) {
          // Matches zero-or-more segments — `/sign-up` is served by `sign-up/[[...sign-up]]/page.tsx`.
          walk(join(dir, e.name), depth);
          if (depth < want.length) walk(join(dir, e.name), depth + 1);
          continue;
        }
        if (isCatchAll) {
          // Matches the rest of the path, so anything at or past this depth resolves.
          if (depth < want.length) walk(join(dir, e.name), want.length);
          continue;
        }
        if (depth < want.length && (isDynamic || e.name === want[depth])) {
          walk(join(dir, e.name), depth + 1);
        }
      } else if (e.name === "page.tsx" && depth === want.length) {
        found = true;
      }
    }
  };
  walk(APP_DIR, 0);
  return found;
}

test("every ${SITE.url} link in an email resolves to a real App Router page", () => {
  const broken: string[] = [];
  for (const { file, path } of emailPaths()) {
    if (!routeExists(path)) broken.push(`${file} → ${path}`);
  }
  assert.deepEqual(
    broken,
    [],
    `these email CTAs point at routes that do not exist:\n  ${broken.join("\n  ")}`
  );
});

test("the route resolver is not vacuously passing", () => {
  // If routeExists() returned true for everything, the test above would be worthless. Pin both
  // directions against known-good and known-bad paths, including the exact path that broke.
  assert.ok(routeExists("/pricing"), "should find a (marketing) group route");
  assert.ok(routeExists("/account"), "should find a (site) group route");
  assert.ok(routeExists("/sign-up"), "should resolve Clerk optional catch-all sign-up route");
  assert.ok(routeExists("/sign-in"), "should resolve Clerk optional catch-all sign-in route");
  assert.ok(routeExists("/vs/others"), "should find a nested route");
  assert.ok(!routeExists("/account/billing"), "the route that caused this bug must NOT resolve");
  assert.ok(!routeExists("/definitely-not-a-real-route"), "arbitrary paths must not resolve");
});

test("billing CTAs point at /account, not a nonexistent billing subroute", () => {
  // Billing is Whop's; /account is where the app explains that and links to the portal. Recording
  // it as a test so a future edit doesn't reintroduce a plausible-looking /account/billing.
  for (const file of ["payment-failed.ts", "scheduled-cancel.ts", "downgrade.ts"]) {
    const src = readFileSync(join(TEMPLATE_DIR, file), "utf8");
    assert.ok(!src.includes("/account/billing"), `${file} links to /account/billing, which does not exist`);
    assert.match(src, /\$\{SITE\.url\}\/account`/, `${file} should send members to /account`);
  }
});

test("every /learn/<slug> link points at content that exists", () => {
  // routeExists() treats `[slug]` as matching any segment — correct for the router, but it means
  // /learn/total-nonsense would pass the first test while 404-ing at runtime via notFound().
  // Dynamic routes need their DATA checked, not just their file.
  const learnLinks = emailPaths().filter(({ path }) => path.startsWith("/learn/"));
  assert.ok(learnLinks.length > 0, "expected emails to link to learn content");
  for (const { file, path } of learnLinks) {
    const slug = path.slice("/learn/".length);
    const isArticle = Boolean(getArticle(slug));
    const isGuide = isLearnGuideSlug(slug);
    assert.ok(isArticle || isGuide, `${file} links to /learn/${slug}, which is neither an article nor a guide`);
  }
});

test("the account page still surfaces a billing portal link", () => {
  // The redirect above is only correct while /account actually offers billing management. If that
  // panel is ever removed, these three emails become dead ends again.
  const panel = "src/components/account/AccountMembershipPanel.tsx";
  assert.ok(existsSync(panel), "AccountMembershipPanel must exist for /account to be a valid billing destination");
  const src = readFileSync(panel, "utf8");
  assert.match(src, /WHOP_CHECKOUT/, "panel must link to the Whop portal");
  assert.match(src, /Manage subscription/, "panel must expose a manage-subscription action");
});
