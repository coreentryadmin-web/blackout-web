## 2026-09-04 — [FINDING, P3 member-facing UI, Vector chart] Volume-profile POC/VAH/VAL labels collided with native price-line axis badges — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED — anchor level labels at `gutterLeft` instead of `rightX - 6`. |
| **Found by** | Live-UI sweep (proxy-browser.cjs), SPX Slayer `/dashboard` embed. See sibling write-up `2026-09-04-vector-chart-volume-profile-axis-label-collision.md` (#3589). |
| **Root cause** | `VolumeProfilePrimitive` drew POC/VAH/VAL labels flush against the price axis while lightweight-charts price-line badges (Pin, gamma flip, VWAP, etc.) occupy the same vertical band. |
| **Fix** | `volumeProfileLevelLabelX()` — left-align labels at the profile band's left edge (`gutterLeft + 4px`), clear of axis badges. |
