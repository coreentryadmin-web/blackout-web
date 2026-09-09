## 2026-09-08 — Thermal's regime-strip delta chip showed an up arrow on a negative delta ("↑-$3.7B") — the arrow was hardcoded, never checked the sign — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **How found** | Live-UI spot-check on `/heatmap` (Thermal desk, GEX matrix, SPY, desktop). The regime strip's "Net GEX" segment read `-$439.9M ↑-$3.7B` — an up arrow directly glued to a negative delta, a visually contradictory pairing (up implying increase, next to a value that decreased). |
| **Root cause** | `ThermalRegimeStrip.tsx` rendered every delta chip as `↑{seg.delta.replace(/^\+/, "")}` — the arrow glyph was a literal `↑` in the JSX, only ever stripping a leading `+` from a positive delta string. `seg.delta` (`thermal-regime-strip.ts`'s `netDeltaChip`) genuinely preserves its own sign from the underlying data (`netDelta.startsWith("+") \|\| netDelta.startsWith("-") ? netDelta : ...`), so a real decrease (e.g. `"-$3.7B"`) reached the component with its `-` intact, but the render path never branched on it. |
| **Blast radius** | Every regime-strip segment that carries a delta chip — confirmed via the one shared `segment()` builder in `thermal-regime-strip.ts`, used by all four lenses (GEX/VEX/DEX/CHARM) — so this affected every negative delta shown anywhere on the strip, not just Net GEX. |
| **Fix** | Extracted a pure `deltaArrowText(delta: string): string` helper (`thermal-regime-strip.ts`) that picks `↓` when the delta starts with `-` and `↑` otherwise, then strips the sign character — so the glyph and the number agree. `ThermalRegimeStrip.tsx` now calls this helper instead of hardcoding the arrow. No change to how deltas are computed or formatted upstream — pure rendering fix. |
| **Regression guard** | `thermal-regime-strip.test.ts` — 3 new tests: a negative delta gets `↓` with the sign stripped; an explicit `+` delta gets `↑` with the sign stripped; an unsigned string (e.g. `"held"`) defaults to `↑` unchanged. RED→GREEN proven via `git stash`: 3/3 new tests fail pre-fix (import error — `deltaArrowText` doesn't exist yet), all pass post-fix; the 5 pre-existing tests in the same file are unaffected. |
| **Evidence** | Targeted suite (`thermal-regime-strip.test.ts`): 8/8 pass. `tsc --noEmit`: clean. Full suite (Node 20): 13328 pass / 0 fail / 3 skipped. |
| **Status** | FIXED — PR opened, merge pending CI/peer-review per standing policy. |
