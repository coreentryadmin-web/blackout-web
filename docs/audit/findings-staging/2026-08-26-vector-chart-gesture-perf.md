> **kind:** FINDING

## Vector chart mouse gestures blocked by heavy bead repaints — FIXED

| **Status** | FIXED (pending deploy) |
|------------|------------------------|
| **Area** | Vector / `VectorChart.tsx` |
| **Severity** | P1 — zoom/drag/clicks feel broken during RTH |

### Root cause

PR #2906 deferred SSE-driven `refreshTrails`/`refreshOverlays` using `memberViewportLocked`, which treats **any prior pan** (`chartUserPannedRef`) as permanently "hot". That was wrong for paint deferral — after the first drag, SSE correctly skipped heavy work, but **other paths kept calling `refreshTrails` every 5s** (horizon history stamp interval, wall-history poll `repaint()`, timeframe effect) with **no gesture guard**. Each call rebuilds bead markers + wall rail primitives over 1k+ history samples → 170–250ms long tasks stacking on the main thread during wheel/drag.

### Fix

- Split **permanent viewport lock** (`memberViewportLocked`) from **active gesture** (`isMemberGesturing` = pointer down OR wheel within 8s).
- Guard `refreshTrails` / `refreshOverlays` during active gestures; queue deferred flush on pointerup / post-cooldown.
- Track pointer down/up on chart container (was mousedown-only, never cleared).
- SSE + crosshair simplified path now uses `isMemberGesturing`, so live bead updates resume after gestures end.

### Evidence

Prod probe pre-fix: `vector-chart-interaction-perf.mjs` — 80 long tasks / ~16s during 25 synthetic wheel events; event dispatch itself fast (~1ms).

### Verification

- `npx tsx --test src/features/vector/components/vector-chart-viewport.test.ts` — 37/37 pass
- `node scripts/audit/vector-chart-interaction-e2e.mjs` — post-deploy on prod
