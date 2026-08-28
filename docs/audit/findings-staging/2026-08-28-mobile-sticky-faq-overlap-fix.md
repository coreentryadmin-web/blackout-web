> **kind:** FINDING

## Home mobile sticky CTA blocked FAQ taps (P2 #2799) — FIXED

| **Status** | FIXED in PR (cursor/mobile-sticky-faq-fix-3d11) |
|---|---|

**Root cause:** `#mobile-sticky-cta` stayed visible for the entire scroll after the hero CTA left the viewport. Expanded FAQ items pushed item 3 into the bar's fixed footprint (53px overlap measured on prod).

**Fix:** `LandingRedesignFx` now suppresses the bar when any `.faq-item` or `.footer` rect overlaps the sticky rect; `toggle` + scroll listeners refresh visibility. Pure helpers in `src/lib/marketing/mobile-sticky-cta.ts`; regression in `homepage-e2e-audit.mjs` (`runMobileFaqSticky`).

**Evidence:** Unit tests pin the measured overlap geometry from FINDINGS; live proof via `npm run validate:homepage-e2e` post-deploy.
