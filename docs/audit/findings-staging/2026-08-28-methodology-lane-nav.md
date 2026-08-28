> **kind:** `FINDING`

## Methodology page lane jump-nav — ADDED

| **Status** | Shipped in PR (cursor/methodology-lane-nav-3d11) |
|---|---|

**Problem:** `/methodology` is a long trust page covering three grading systems. Readers had no in-page way to jump between SPX Slayer, Night Hawk, and 0DTE Command sections — only endless scroll.

**Fix:** Sticky `MethodologyLaneNav` with anchor pills + `scroll-margin-top` section IDs. Repo guard extended in `methodologyPageGate` (live marketing-funnel audit).

**Evidence:** `src/components/landing/methodology-lane-nav.test.ts` locks nav + anchor parity; `validate:marketing-funnel` live gate checks rendered nav.
