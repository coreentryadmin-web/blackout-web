## 2026-09-04 — [BUG, P3 member-facing UI, Vector chart / SPX Slayer] Volume-profile POC/VAH/VAL labels collided with native price-line axis badges — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Found by** | Live-UI sweep (proxy-browser.cjs + pixel measurement), SPX Slayer desk — documented in parallel by Claude PR #3589 before this fix landed. |
| **Evidence** | `/dashboard` at 430×932: orange "Pin 7,746" axis badge painted over gray "POC" label at the right edge. Regression test `vector-volume-profile-primitive.test.ts` asserts labels anchor at `gutter.gutterLeft + 4` with `textAlign: left`, not `rightX - 6`. |
| **Root cause** | `VolumeProfilePrimitive` drew POC/VAH/VAL labels at `rightX - 6` (flush to the price axis) while lightweight-charts price-line axis badges occupy the same y-band. |
| **Fix** | Anchor level labels at the left edge of the profile band (`gutterLeft + 4px`, left-aligned) — sidesteps axis-badge collision without suppressing labels. |
| **Blast radius** | Shared `VectorChart` primitive — SPX Slayer `/dashboard`, `/vector`, compare panes. |
