> **kind:** FINDING

## Homepage "How BlackOut thinks" pipeline stuck at OFFLINE under reduced motion — FIXED

| **Status** | Fixed in this PR |

**Root cause:** `LandingRedesignFx.tsx`'s single effect starts with
`const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; if (reduce) return;`
— an early return that skips the ENTIRE effect, including the "Intelligence Pipeline" scroll-reveal
IntersectionObserver that flips each of the four stage badges from the markup's default `OFFLINE`
text to `ONLINE` once the stage scrolls into view. Reduced motion correctly should skip the
decorative canvas/parallax animation, but the OFFLINE→ONLINE swap is *informational state*, not
decoration — a page marketing the platform as live should never permanently tell a visitor the
pipeline is offline. Any browser/OS with `prefers-reduced-motion: reduce` set (a real accessibility
setting, and the default many crawlers/audit tools use) never fires the observer, so all four
stages read OFFLINE forever for that visitor.

**Evidence:** `curl -s https://blackouttrades.com/ | grep -c OFFLINE` returns 2+ occurrences in the
raw, un-hydrated homepage HTML (confirmed live 2026-09-02) — that raw markup is exactly what a
non-JS or reduced-motion crawl sees. This matches a QA report flagging the same defect as observed
and unresolved across repeated crawls.

**Fix:** When `reduce` is true, the effect now directly marks every `[data-pipe-stage]` element
`pipe-lit` and sets its `.pipe-status` text to `ONLINE` (no animation, immediate) before returning
— giving reduced-motion visitors the correct informational state without the scroll-triggered
reveal or any of the decorative canvas/parallax work.

**Blast radius:** Single file (`LandingRedesignFx.tsx`); no other page uses this effect.

**Fix rationale:** Kept the fix minimal — a direct DOM update mirroring exactly what the existing
IntersectionObserver callback already does (`el.classList.add("pipe-lit")` +
`statusEl.innerHTML = '<span class="status-dot"></span>ONLINE'`), so the two code paths stay
visibly in sync rather than diverging into two different "online" renderings.

**Separately investigated, not changed:** the homepage's public gamma-tool "warming" state
(`HomeGammaPromo.tsx` / `buildPublicGexSnapshot`) reported by the same QA crawl. Confirmed the
underlying `/api/public/gex-snapshot?ticker=SPX` endpoint is live and healthy right now
(`available: true`, real `asof`), and the component already fetches immediately on mount plus
every 5s while visible (comment in the code explicitly documents this as a prior fix for exactly
this class of staleness). The `warming` text visible in a raw `curl` of the homepage is the
`revalidate = 3600` ISR snapshot plus the Cloudflare edge cache (`edge_ttl 7200` for anonymous
requests, per `CLAUDE.md`) — real browsers self-heal within ~5s of the client JS running, so this
reads as an accepted architectural tradeoff (fast static-first-paint, live self-heal) rather than a
code bug to patch here. Flagging for awareness, not fixing, to avoid scope creep into an ISR/edge-
cache TTL change that needs its own cost/staleness tradeoff discussion.

**Test:** `src/components/landing/LandingRedesignFx.test.ts` — regex-asserts the reduced-motion
branch touches `[data-pipe-stage]` and sets `ONLINE`. Verified fails pre-fix (`git stash`) / passes
post-fix. `npx tsc --noEmit`: clean.
