## 2026-08-28 — [FINDING, P1 marketing/mobile] Mobile drawer Platform link did not land on #protocol — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | `validate:homepage-e2e` mobile pass reported `MOBILE_ANCHOR`: Expected `#protocol` got empty after tapping Platform in the mobile nav drawer on production. |
| **Root cause** | `MarketingMobileNav` used Next.js `<Link href="/#protocol">` with `onClick={close}`. Client-side navigation from `/?_cb=…` to `/#protocol` often drops the URL fragment, so `location.hash` stayed empty even though the drawer closed. |
| **Fix** | `onHashNavClick` intercepts same-page homepage hash links: `preventDefault`, `scrollIntoView` on the target section, `history.replaceState` to set the hash explicitly. |
| **Evidence** | Prod audit before fix: `issue_count: 1`, `MOBILE_ANCHOR`. Unit guard in `marketing-mobile-nav.test.ts` locks the handler. |
| **Status** | FIXED — `src/components/landing/MarketingMobileNav.tsx`, `marketing-mobile-nav.test.ts`. |
