> **kind:** FINDING

## Vector default viewport squished current candle; single-name beads sparse vs SPX — FIXED

| **Status** | FIXED (pending deploy) |
|------------|------------------------|
| **Area** | Vector / viewport + node density |
| **Severity** | P1 — desk unusable on load for NVDA/single names |

### Root cause

1. **Viewport:** `defaultChartViewport: "session"` fit the entire RTH day on first paint — the forming candle was a tiny sliver on the far right; members had to scroll/drag to see price action.
2. **Bead parity:** SPX opened at **20 rows/side** while single names used **AUTO**, self-limiting NVDA to ~7 rows on coarse $2.50 strike ladders despite the server recording 20/side.

### Fix

- Default desk open → **`live`** centered window (~48 bars, latest candle mid-screen) via `centeredLiveVisibleLogicalRange` + `applyCenteredLiveViewport`.
- **`defaultVectorNodeDensity` → 20 for every symbol** (SPX parity); AUTO floor raised to 12 for members who manually pick AUTO.
- Gesture perf deferral from sibling change (`isMemberGesturing`) keeps wheel/drag responsive during repaints.

### Verification

- Unit: `vector-chart-viewport.test.ts`, `vector-ticker-default-horizon.test.ts`, `vector-candle-render.test.ts`
- Post-deploy: `node scripts/audit/vector-chart-interaction-e2e.mjs` on `/vector?ticker=NVDA`
