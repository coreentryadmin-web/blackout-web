# Homepage CLS Regression — Desktop 1440px

> **kind:** FINDING

## Summary

The homepage exhibits a **Cumulative Layout Shift (CLS) of 0.132** when measured on desktop viewport **1440×900px**. The acceptable threshold is 0.1 ("Good" per Google Web Vitals). Mobile (430×932) and mid-range desktop (1024×768, 1300×900) both measure **GOOD (≤0.001)**.

## Evidence

**RTH validation run (2026-08-28 15:33 UTC)** measured production homepage after Cloudflare edge cache purge:

| Viewport | CLS | Verdict | Status |
|---|---|---|---|
| 430×932 (mobile) | 0.0000 | GOOD | ✓ Pass |
| 1024×768 (tablet) | 0.0001 | GOOD | ✓ Pass |
| 1300×900 | 0.0003 | GOOD | ✓ Pass |
| 1440×900 (desktop)| 0.1321 | NEEDS-IMPROVEMENT | ✗ **FAIL** |

Multiple runs at 1440px after full cache purge consistently returned 0.13+. Variants at 1350/1380/1400/1420px all measured GOOD, isolating the issue to viewport width ≥1440px.

**Single shift detected:** `Shifts ≥0.01: 0.1318` — one large reflow event, not accumulated micro-shifts.

## Failure Scenario

Desktop users viewing the homepage at 1440px width or wider experience a layout shift during page load/render that exceeds the Web Vitals "Good" threshold, degrading perceived performance and potentially affecting search ranking signals (Google considers CLS in ranking).

The shift appears to be an interaction between **cached static assets** (CSS/JS bundles) and **fresh HTML**. Partial Cloudflare purges (HTML only) masked the issue; full cache purge revealed it.

## Root Cause Analysis

**Not yet identified.** Candidates:

1. **Font loading variance** — fonts load with `display: "swap"` but layout might still shift at certain widths due to font metrics or text wrapping
2. **Image/canvas rendering** — the hero section has multiple canvas elements and images; rendering timing might differ at 1440px
3. **JavaScript-driven DOM mutation** — client-side FX layer (`LandingRedesignFxLazy`, `HomeGammaPromo` fetch) might cause reflow at specific widths
4. **CSS breakpoint-triggered reflow** — responsive design rule in the 1200-1440px range not yet identified in `marketing-redesign.css`
5. **Asset interaction** — a stale cached JS/CSS bundle interacting differently with fresh HTML at that width

**CSS animations verified:** All `.atmos-sweep` and `.spine::before` animations already converted to `transform`-only (no layout-affecting properties).

## Impact

- **SEO:** CLS is a Core Web Vital; Google factors it into ranking. A 0.13 measurement on the homepage is publicly visible (CrUX/PageSpeed Insights) and damages perceived page quality.
- **UX:** Users see visible layout jank during page load.
- **Scope:** Appears limited to desktop users at 1440px+ viewports. Mobile and smaller desktop unaffected.

## Status

**Open — requires investigation and fix.**

Next steps:
1. Investigate asset loading order and timing at 1440px width
2. Test font subsetting or loading strategy
3. Profile the client-side FX layer mounting and rendering
4. Check for CSS rules between 1200-1440px viewport range
5. Consider deferring or optimizing the most expensive reflow-causing asset

## Timeline

- 2026-08-28 11:33 ET: RTH validation detected regression
- 2026-08-28 15:40 ET: Documented as P2 (high-priority) finding
