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
  // default to OFFLINE in the JSX and only flip to a "live" state via a runtime scroll-triggered
  // IntersectionObserver (or a reduced-motion fallback). That runtime dependency meant ANY
  // non-JS reader (a crawler, an SEO scraper, a social-preview bot, or simply the first paint
  // before a visitor scrolls that far) saw the platform's own marketing page describe itself as
  // offline. The fix removes the dependency entirely: each badge is a static, always-true,
  // stage-specific label (SCAN / VERIFY / STRUCTURE / LOGGED) baked into the server-rendered
  // markup, so there is no window — reduced motion, no motion, no scroll, no JS at all — in
  // which it reads wrong.
  const stageLabels = ["SCAN", "VERIFY", "STRUCTURE", "LOGGED"];
  for (const label of stageLabels) {
    assert.match(
      homeSrc,
      new RegExp(`<span className="status-dot" />${label}</div>`),
      `expected the pipeline stage badge to render a static ${label} status`
    );
  }
  assert.doesNotMatch(homeSrc, /OFFLINE/, "no pipeline stage badge may default to OFFLINE in server-rendered markup");
});

test("the pipeline effect no longer mutates stage-status TEXT at runtime (badge is static now)", () => {
  // The old scroll-reveal and reduced-motion fallback both wrote `.innerHTML = '...ONLINE'` into
  // the badge — now redundant (and a second source of truth to drift) since the badge text is
  // already correct from the server. Runtime code may still toggle a `.is-live` CSS class for
  // the purely decorative glow, but must never touch the badge's text content again.
  assert.doesNotMatch(fxSrc, /pipe-status[\s\S]{0,120}innerHTML/, "the pipe-status badge text should not be mutated at runtime anymore");
});
