> **kind:** FINDING

## Onboarding guided tour never introduces Vector or Meridian — FIXED

**Status:** FIXED (regression test added, RED→GREEN proven)

### Root cause

`src/lib/onboarding-content.ts`'s `ONBOARDING_STEPS` array drives `OnboardingGuide.tsx`, the
global first-run modal that auto-opens once per `ONBOARDING_VERSION` for every newly signed-in
member (mounted once in the root layout, reopenable from the Learn menu). The array's own
top-of-file comment states the intent explicitly: `// Guided tour of the platform — keep aligned
with Nav FEATURE_LINKS.` (`FEATURE_LINKS` in `Nav.tsx` is literally `DESK_NAV_LINKS`, the
canonical 7-desk list in `src/lib/desk-nav-links.ts`: SPX Slayer, HELIX, BlackOut Thermal, Largo,
Night Hawk, Vector, Meridian).

Nothing enforced that alignment. The steps shipped were: `welcome`, `spx` (`/dashboard`), `flows`
(`/flows`), `heatmap` (`/heatmap`), `largo` (`/terminal`), `nighthawk` (`/nighthawk`), `zerodte`
(`/nighthawk`, Evening Edition), `finish` — stopping at 6 of the 7 desks, and never once
mentioning `/vector` or `/meridian`. This is the same hand-maintained-map-drifts-from-source-of-
truth bug class as #7370 (`ga4-events.ts`'s `DESK_PATH_PREFIXES` missing Meridian), except here
the drift is in the product's own new-member introduction flow rather than analytics
instrumentation, so the user-facing consequence is worse: a brand-new signed-in member who
completes onboarding never sees the words "Vector" or "Meridian" anywhere in the platform's own
guided walkthrough, even though both are live, fully-shipped, equally-billed desks (same
`PRODUCT_MANIFEST` tier as every other desk — `manifestPremiumIncludes()` lists all 7).

Likely cause: Vector and Meridian both launched after the onboarding tour was first written, and
each desk's launch PR updated the places with an explicit completeness test
(`product-manifest-consistency.test.ts` already has dedicated regression tests for Vector/Meridian
coverage on the homepage, pricing, Learn/Academy chapters, FAQ, and SEO surfaces) but
`onboarding-content.ts` had no such test, so its own comment's intent silently went unenforced for
two desk launches in a row.

### Evidence

Before the fix, `src/lib/onboarding-content.ts`'s `ONBOARDING_STEPS` had exactly these `href`
values: `/dashboard`, `/flows`, `/heatmap`, `/terminal`, `/nighthawk`, `/nighthawk` — six entries
covering 5 distinct desks (Night Hawk's own route appears twice, for the 0DTE Command and Evening
Edition sub-stories), vs. `DESK_NAV_LINKS`' 7 desk hrefs (`/dashboard`, `/flows`, `/heatmap`,
`/terminal`, `/nighthawk`, `/vector`, `/meridian`). `/vector` and `/meridian` are absent.

Added regression test `src/lib/onboarding-content.test.ts` — *"every canonical desk has a
guided-tour step (ONBOARDING_STEPS does not drift from DESK_NAV_LINKS)"* — asserts every
`DESK_NAV_LINKS` href has a matching `ONBOARDING_STEPS[].href`. Proven RED before the fix
(`git stash` the `onboarding-content.ts` change only, test fails:
`missing: ['Vector', 'Meridian']`) and GREEN after (`npx tsx --experimental-test-module-mocks
--test src/lib/onboarding-content.test.ts` → 6/6 pass).

### Blast radius

Single consumer: `src/components/OnboardingGuide.tsx` reads `ONBOARDING_STEPS` directly (mounted
once in the root layout, auto-opens for every new signed-in member, and is manually reopenable via
the `ONBOARDING_OPEN_EVENT` window event from the Learn menu). No other file reads
`ONBOARDING_STEPS`. Fixing the array fixes every surface that renders it — there is no second
hand-copy of this specific list to chase (checked: `grep -rn "ONBOARDING_STEPS"` across `src/`
returns only the definition, the component, and the test file).

### Fix rationale

Added two new steps — `vector` (`/vector`) and `meridian` (`/meridian`) — positioned after the
existing Night Hawk/Evening Edition steps and before `finish`, matching `DESK_NAV_LINKS`'
canonical desk order (`.../nighthawk`, `/vector`, `/meridian`). Copy follows the same short,
plain-English, 1-2 sentence style as the other desk steps (`spx`/`flows`/`heatmap`/`largo`), each
with an `href`+`cta` deep link ("Open Vector" / "Open Meridian") consistent with every other step
that has a concrete desk to link to.

Deliberately did not touch `OnboardingGuide.tsx` (it already renders whatever `ONBOARDING_STEPS`
contains generically — no desk-specific logic lives there) or `ONBOARDING_VERSION` (bumping it
would force every existing member who already dismissed onboarding to see it again; the operator
did not ask for that, and it's a product/marketing call outside this fix's scope — flagging it
here in case the team wants new desk coverage to re-surface for existing members).

Added the drift-guard test directly against `DESK_NAV_LINKS` (not `PRODUCT_MANIFEST`) because the
array's own comment already names `Nav FEATURE_LINKS` (`=== DESK_NAV_LINKS`) as the alignment
target — asserting against the thing the comment already promises, rather than inventing a new
contract.
