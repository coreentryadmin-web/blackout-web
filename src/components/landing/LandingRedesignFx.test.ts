import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const homeSrc = readFileSync(join(root, "src/components/landing/RedesignHome.tsx"), "utf8");
const fxSrc = readFileSync(join(root, "src/components/landing/LandingRedesignFx.tsx"), "utf8");

test("the Intelligence Pipeline stage badges never render OFFLINE in server-rendered markup", () => {
  // Confirmed live 2026-09-02 via `curl blackouttrades.com`: the raw, un-hydrated homepage HTML
  // showed all four "How BlackOut thinks" stage badges as OFFLINE — because the badges used to
  // default to OFFLINE in the JSX and only flip to ONLINE via a runtime scroll-triggered
  // IntersectionObserver (or a reduced-motion fallback). That runtime dependency meant ANY
  // non-JS reader (a crawler, an SEO scraper, a social-preview bot, or simply the first paint
  // before a visitor scrolls that far) saw the platform's own marketing page describe itself as
  // offline. The fix removes the dependency entirely: the badge is a static, always-true "LIVE"
  // baked into the server-rendered markup, so there is no window — reduced motion, no motion,
  // no scroll, no JS at all — in which it reads wrong.
  const stageBadgeCount = (homeSrc.match(/<span className="status-dot" \/>LIVE<\/div>/g) ?? []).length;
  assert.equal(stageBadgeCount, 4, "expected all 4 pipeline stage badges to render a static LIVE status");
  assert.doesNotMatch(homeSrc, /OFFLINE/, "no pipeline stage badge may default to OFFLINE in server-rendered markup");
});

test("the pipeline effect no longer mutates stage-status text at runtime (badge is static now)", () => {
  // The old scroll-reveal and reduced-motion fallback both wrote `.innerHTML = '...ONLINE'` into
  // the badge — now redundant (and a second source of truth to drift) since the badge is already
  // correct from the server. Guards against reintroducing that text mutation.
  assert.doesNotMatch(fxSrc, /pipe-status[\s\S]{0,120}innerHTML/, "the pipe-status badge should not be mutated at runtime anymore");
});
