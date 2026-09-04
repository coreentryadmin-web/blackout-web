## 2026-09-04 — [FIXED, P3 member-facing UI, Vector chart] Volume-profile POC/VAH/VAL labels anchored at profile band left edge — axis-badge collision

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED — labels now draw at `gutterLeft + VP_LABEL_LEFT_PAD_PX` with `textAlign: left` instead of `rightX - 6` under native price-line axis badges. |
| **Root cause** | `VolumeProfilePrimitive` drew level text flush against the price axis while lightweight-charts price-line badges extend leftward into the pane. |
| **Fix** | `volumeProfileLabelAnchorX()` in `vector-volume-profile-layout.ts`; primitive uses left anchor per finding option (c). |
