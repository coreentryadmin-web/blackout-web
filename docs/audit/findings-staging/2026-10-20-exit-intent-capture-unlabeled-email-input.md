> **kind:** FINDING

## Site-wide exit-intent lead-capture form had an unlabeled email input — FIXED

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, DISCOVERY-lane accessibility sweep (`docs/audit/FULL-LIFECYCLE SCOPE
EXPANSION` mandate), via a background Explore-agent static audit of marketing-facing components.

**Root cause:** `src/components/marketing/ExitIntentCapture.tsx`'s email `<input>` (the site-wide
exit-intent lead-capture modal, offering the free GEX cheat sheet) had no `<label htmlFor>`,
`aria-label`, or `aria-labelledby` — only a `placeholder="you@example.com"`. The surrounding
`Modal` primitive correctly labels the *dialog* itself (`aria-label`/`aria-labelledby` on the
panel, title "Before you go"), but that labeling does not propagate to the input inside it.
Placeholder text is not a reliable accessible-name substitute: it is not consistently announced by
screen readers the way a real label is, and it disappears entirely once the visitor starts typing,
leaving the field with no name at all for the rest of the interaction.

**Live impact:** this component mounts once in `MarketingPageShell`, so it applies to every
marketing page (homepage, pricing, FAQ, learn articles, etc.) — a screen-reader user tabbing into
the exit-intent form heard only "edit text" with no indication the field expected an email address,
on any page where the modal could fire.

**Fix:** added `aria-label="Email address"` to the input — no visual change (the placeholder stays
as the visible hint), purely an accessible-name fix for assistive technology.

**Blast radius:** single component, single mount point (`MarketingPageShell`). No other form input
in the files checked this cycle (`StaticMarketingNav`, `MarketingMobileNav`, `RedesignHome`,
`StaticLandingFooter`, `HomeGammaPromo`, `MethodologyLaneNav`, `LegalPageLayout`,
`Breadcrumbs`) had the same defect — all were independently verified clean (real `<button>`/`<Link>`
elements for interactive controls, correct `alt`/`aria-hidden` on images, no color-only
information, no skipped heading levels).

**Test:** `src/components/marketing/ExitIntentCapture.test.ts` (new file) — source-inspection
regression test asserting the email input carries an `aria-label`. RED→GREEN proven via `git
stash` on the component alone (fails without the fix, passes with it). Repo-wide `npx tsc --noEmit`
clean.
