## 2026-09-04 — [FINDING, P3 member-facing UI, Vector chart] Volume-profile POC/VAH/VAL labels collided with native price-line axis badges — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Root cause** | `VolumeProfilePrimitive` drew POC/VAH/VAL labels right-aligned at `rightX - 6`, the same band lightweight-charts uses for opaque price-line axis badges (Pin, Gamma flip, VWAP, etc.). No collision awareness between the two rendering layers. |
| **Fix** | Anchor labels left-aligned at `gutterLeft + 4` — the start of the profile bar band, away from the price axis. `project()` now carries `gutterLeft` alongside `rightX`. |
| **Regression guard** | `src/features/vector/lib/vector-volume-profile-primitive.test.ts` — source assertions on label anchor (RED→GREEN via `git stash`). |
| **RTH check** | On `/dashboard` or `/vector` with volume profile enabled, zoom until Pin (or any axis badge) and POC are within one label-height in price — both labels must remain independently legible. |
