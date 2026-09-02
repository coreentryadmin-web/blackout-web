## 2026-09-02 — [FINDING, P1 marketing/trust] Public homepage showed OFFLINE pipeline stages, warming gamma snapshot, and stale product taxonomy — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **What prompted this** | Operator audit of the public homepage acquisition surface: free gamma snapshot stuck on "Snapshot warming up — check back shortly." despite 5s refresh copy; "How BlackOut thinks" pipeline rendered OFFLINE for all four stages (trust bug — reads as platform down); product carousel still said "Six engines" while Premium includes Meridian; Night Hawk marketed as swing/overnight; Vector labeled "Soon" while live; Premium pricing bullets omitted Thermal/Vector/Meridian by name. |
| **Root cause** | (1) `buildPublicGexSnapshot` returned empty warming state on upstream miss with no last-good fallback. (2) `LandingRedesignFx.tsx` rewrote `.pipe-status` innerHTML to ONLINE/OFFLINE on scroll while SSR seeded conflicting labels — double-exposed garbled OFFLINE text. (3) Homepage copy hardcoded engine count and product cards instead of `src/lib/marketing/products.ts` registry. |
| **Fix** | Last-good Redis cache (`public-gex-snapshot:last-good:{ticker}`) served with `degraded: true` + timestamp when live feed misses; prolonged warming (>300s) pages via `captureError` + `shouldAlarmPublicGexWarming`. Pipeline labels → semantic static SCAN/VERIFY/STRUCTURE/LOGGED; FX only adds `.is-live` class. Canonical 7-product registry drives module headline, pricing perks, Night Hawk 0DTE positioning, Vector live status. `HomeLiveDeskStrip` under hero; `HomeGammaPromo` shows cached badge when degraded. |
| **Blast radius** | Marketing surfaces only: `RedesignHome.tsx`, `HomeGammaPromo.tsx`, `public-gex-snapshot.ts`, `marketing/products.ts`, FAQ/onboarding copy softening zero-delay claims. |
| **Regression guard** | `public-gex-snapshot-degraded.test.ts`, `public-gex-snapshot.test.ts` (warming alarm), `products.test.ts`, `RedesignHome.seo.test.ts` (no OFFLINE seed, no ::after duplicate labels). |
| **Status** | FIXED. |
