## 2026-09-04 — [P3, IA/onboarding] Learn hub still described Night Hawk as evening-only after the 0DTE Command redesign — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P3 — stale onboarding/navigation copy, not a data-correctness bug. Real user-reported confusion risk: a prospective member reading `/learn` would conclude Night Hawk is an evening-only product, contradicting the homepage. |
| **Found by** | User report (operator), independently confirmed against `src/lib/marketing/product-manifest.ts` |
| **Status** | FIXED |

### Root cause

`src/lib/learn/nav.ts`'s `LEARN_NAV` array — the Learn hub's own product-navigation metadata,
rendered as the chapter list in `LearnSidebar.tsx` and the Course JSON-LD schema — described the
`night-hawk` chapter as:

> "Evening playbook — tomorrow's setups, scored tonight."

This predates the Night Hawk redesign that made **0DTE Command** (an always-on, multi-ticker
intraday scanner running through RTH) the desk's primary workflow, with Evening Edition as the
post-close secondary component. The live homepage already reflects this correctly —
`PRODUCT_MANIFEST.hawk.positioning` in `src/lib/marketing/product-manifest.ts` (line 130) reads:

> "0DTE Command runs during RTH as an always-on, multi-ticker intraday scanner with Cortex gates
> on every commit. Evening Edition publishes post-close prep for the next session. One desk for
> the full session arc — not a swing-only product."

— and that file even carries an explicit standing comment (line 6): *"Never describe Night Hawk
as swing-only."* An earlier fix already closed this exact gap in the marketing manifest (see the
existing `product-manifest-consistency.test.ts` test `"Night Hawk manifest positions 0DTE Command
first, not swing-only"`), but `LEARN_NAV` is a **separate, hand-authored array** — not derived
from the manifest — so that earlier fix never reached it. The dedicated Night Hawk Academy guide
(`src/lib/learn/guides/instruments/night-hawk.ts`) also still frames the whole chapter around
"Evening Edition prep and pre-market confirmation" (its `description` field), consistent with the
stale nav copy, though this fix scopes to the nav descriptor specifically as the most
visible/first-touch surface (the one the user's report quoted verbatim).

### Evidence

Live comparison, same day:
- Learn hub nav (`nav.ts:50`, before fix): "Evening playbook — tomorrow's setups, scored tonight."
- Homepage (`product-manifest.ts:130`): "0DTE Command runs during RTH as an always-on,
  multi-ticker intraday scanner... not a swing-only product."
- Dedicated Night Hawk guide confirms 0DTE Command is the always-on intraday component and
  Evening Edition is the post-close component (`night-hawk.ts` overview, `night-hawk-0dte-command-guide`
  article in `articles.ts`).

RED (`git stash` on `nav.ts` only, test kept applied): 1/12 tests in
`product-manifest-consistency.test.ts` fail — the new nav-descriptor test correctly flags the
stale "Evening playbook" framing. GREEN after restoring: 12/12 pass. `npx tsc --noEmit` clean.
Also re-ran `CourseJsonLd.ssr.test.ts`, `learn-slug-404.test.ts`, `guide-faqs.test.ts` (all
consumers of `LEARN_NAV`) — 6/6 pass, no regression.

### Fix

Changed `LEARN_NAV`'s `night-hawk` entry description to: "Always-on 0DTE scanner during RTH, plus
next-session Evening Edition prep." — matching the manifest's own framing (0DTE Command first,
Evening Edition as the secondary/next-session component).

Added a regression test to `product-manifest-consistency.test.ts` (the file that already guards
the manifest against this exact "swing-only"/evening-only regression) asserting `LEARN_NAV`'s
night-hawk descriptor doesn't start with "Evening playbook" and mentions "0DTE" or "intraday" —
so the manifest and the Learn nav can no longer drift apart on this claim again independently.

### Blast radius

Single line in `nav.ts` plus one new test. `LEARN_NAV` is read by `LearnSidebar.tsx` (chapter nav
UI), `CourseJsonLd.ssr.test.ts`/the actual Course JSON-LD schema builder (chapter descriptions in
structured data), and `curriculum.ts` (chapter numbering) — all inherit the corrected description
automatically since none hardcode their own copy of it. No other product's `LEARN_NAV` entry was
touched.

### Fix rationale

Match the exact framing already established and tested for the manifest ("0DTE Command runs
during RTH... Evening Edition publishes post-close prep... not a swing-only product") rather than
inventing new copy, so the nav descriptor and the homepage/manifest positioning stay in lockstep
in substance, even though they remain two separate hand-authored strings (no shared source yet —
see "what was deliberately left unchanged").

### What was deliberately left unchanged

Did not centralize `LEARN_NAV` descriptions into `PRODUCT_MANIFEST` itself (the user's broader
recommendation — "centralize each product's name, tagline, capabilities and canonical guide URL
in one product manifest consumed by Homepage, Pricing, Academy, About and SEO metadata"). That is
a real architectural change (`LearnNavItem` and `ProductManifestEntry` have different shapes and
different consumers — Academy chapters need `slug`/`tag` for routing that the manifest doesn't
carry, and the manifest needs `capabilities`/`faqAnswer` the nav doesn't) worth scoping as its own
follow-up rather than folding into a P3 copy fix; the regression test added here is the minimum
guard against this specific class of drift recurring in the meantime. Did not touch the dedicated
Night Hawk Academy guide's own `description` field (`guides/instruments/night-hawk.ts`) — that
guide's body content already correctly explains both 0DTE Command and Evening Edition in detail;
only its one-line chapter-list summary shares the same "Evening..." framing as the now-fixed nav
descriptor, and is lower-visibility (surfaced inside the chapter page, not the top-level nav) — a
candidate for a fast, low-risk follow-up but out of scope for this fix to keep the PR small.
