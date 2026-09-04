## 2026-09-04 — [FINDING, P3 member-facing UI, Vector chart / SPX Slayer] Volume-profile POC/VAH/VAL labels are drawn flush against the price axis with no collision awareness — a native price-line axis label (Pin, Gamma flip, VWAP, spot, EMA…) painted on top makes the level label unreadable whenever the two price levels land close together — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Found by** | Live-UI sweep (proxy-browser.cjs + pixel measurement), SPX Slayer desk, per the standing FULL-LIFECYCLE SCOPE EXPANSION mandate's live-UI coverage. |
| **Evidence** | `proxy-browser.cjs` capture of `/dashboard` (SPX Slayer desk — embeds the shared Vector chart component) at 430x932: the light-gray "POC" volume-profile level label was almost entirely painted over by the orange "Pin 7,746" native price-line axis-label badge sitting directly on top of it. |
| **Root cause** | Two independent label-rendering systems shared the right edge: lightweight-charts price-line axis badges (opaque, always on top) and `VolumeProfilePrimitive` drawing POC/VAH/VAL via `ctx.fillText(lvl.label, rightX - 6, lvl.y)` with `textAlign: "right"`. No collision awareness between the two layers. |
| **Blast radius** | `VolumeProfilePrimitive` is shared across `/dashboard`, `/vector`, and Compare panes. |
| **Fix** | Anchor POC/VAH/VAL labels at `gutter.gutterLeft + 4` with `textAlign: "left"` — the profile bars already reserve that horizontal band and axis badges do not extend that far left. Regression test: `vector-volume-profile-primitive.test.ts`. |
| **Live check (RTH)** | On `/dashboard` with volume profile + Pin projection both visible, confirm POC/VAH/VAL labels are legible at the left edge of the profile band even when Pin/Gamma-flip axis badges sit at the same price level. |
