> **kind:** FINDING

## Homepage pipeline badges permanently fixed to never render OFFLINE — supersedes the reduced-motion-only patch

| **Status** | Fixed in this PR |

**Follow-up to #3313.** That PR fixed one specific path (reduced motion) where the "How BlackOut
thinks" pipeline stage badges got stuck at their default `OFFLINE` text. A live re-crawl afterward
confirmed via `curl blackouttrades.com` that the raw HTML STILL showed `OFFLINE` — expected,
because that fix only changed client-side runtime behavior; the badges' default markup (what any
non-JS reader — crawler, SEO scraper, social-preview bot, or the first paint before a real visitor
scrolls that far — actually sees) was untouched. The underlying design (`OFFLINE` baked into SSR
markup, flipped to `ONLINE` only by a scroll-triggered `IntersectionObserver`) meant there was
ALWAYS a window — before scroll, before hydration, or with JS disabled entirely — where the
platform's own marketing page described its "Identify → Validate → Execute → Results" pipeline as
offline while every other section markets the platform as live.

**Root cause:** the OFFLINE→ONLINE text swap was never actually tracking a real operational state —
it was a decorative "power on" animation trope applied to a badge that reads as a genuine status
indicator (status-dot + all-caps word). The four pipeline stages are always-running product
capabilities; there's no real "offline" state to represent.

**Fix:** removed the fake binary status entirely. All four badges (`RedesignHome.tsx`) now render a
single static `LIVE` label baked directly into server-rendered markup — true from the very first
byte the server sends, independent of JS, motion preference, or scroll position. `LandingRedesignFx.tsx`
no longer mutates the badge text at runtime (in either the reduced-motion branch or the
`IntersectionObserver` callback) — it still marks stages `pipe-lit` for the purely decorative
CSS glow on scroll-into-view, with no textual claim attached to that class anymore.

**Blast radius:** `RedesignHome.tsx`, `LandingRedesignFx.tsx`. Updated an existing regression test
(`RedesignHome.seo.test.ts`) that asserted the old JS-authored-ONLINE-text invariant (guarding
against a real prior bug: a CSS `::after` duplicating the JS text and rendering garbled overlapping
words) — the invariant is now simpler: no runtime mutation of `.pipe-status` at all, and no CSS
`::after` content on it either.

**Fix rationale:** rejected the alternative (replacing OFFLINE/ONLINE with the reviewer-suggested
static stage names DISCOVER/VERIFY/SURFACE/TRACK) because those would sit directly next to and
duplicate the existing `<h3>` headers (Identify/Validate/Execute/Results) with near-synonymous
words — confusing, not clarifying. A single accurate, permanent "LIVE" status is simpler and
removes the entire class of bug (no runtime dependency = no window where it can be wrong).

**Test:** `LandingRedesignFx.test.ts` rewritten to assert (a) all 4 badges render static `LIVE` in
`RedesignHome.tsx`'s source and `OFFLINE` never appears, (b) `LandingRedesignFx.tsx` no longer
mutates `.pipe-status` via `innerHTML`. Verified both fail against the current `main` / pass
post-fix. `RedesignHome.seo.test.ts`'s existing double-render guard updated to match (still passes,
still catches a reintroduced CSS `::after`). `npx tsc --noEmit`: clean.
