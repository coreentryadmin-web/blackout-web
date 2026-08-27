> **kind:** FINDING

## Vector wide-desktop page still scrolled ~100px after #2936 — FIXED

| **Status** | FIXED in `cursor/vector-wide-desktop-no-scroll-3d11` |
| **Severity** | P2 — desk UX |
| **Surface** | `/vector` @ ≥1600px |

### Symptom

Post-#2936 prod audit: chart column height matched grid (788px @ 1680×900), but `scrollHeight` was still 1003 vs `innerHeight` 900 (~103px page scroll). Harness `ui:grid-no-page-scroll-*` failed.

### Root cause

`calc(100dvh - 7rem)` on `.vector-chart-terminal-grid` budgeted nav+toolbar only. The collapsed **Universe scanner** summary row below the grid (~48px + gap) was outside the budget, so total page content exceeded one viewport even though the grid row fix worked.

### Fix

At `@media (min-width: 1600px)`, mirror `.vector-compare-page` flex chain: cap `.vector-page-shell` to `calc(100dvh - var(--nav-offset))`, flex column through `.vector-page-content > div`, toolbar + scanner `flex: 0 0 auto`, grid `flex: 1 1 0; height: auto` (keep `grid-template-rows: minmax(0,1fr)` + `overflow: hidden` from #2936).

### Evidence

- Pre-fix: `npm run validate:vector-e2e` → `ui:grid-no-page-scroll-1680x900` FAIL (scroll 1003 vs 900; chart 788 = grid 788)
- Post-fix: pending prod deploy + re-run harness
