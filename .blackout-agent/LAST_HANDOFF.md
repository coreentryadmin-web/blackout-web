# LAST HANDOFF — cursor

**At:** 2026-09-05T14:28:00.000Z
**Run:** 3978-ci-fix-3972-poll

## Summary

**main @ `3637f6db3`**

### 🚨 #3971 — CI GREEN, gate watch active
| Field | Value |
|-------|-------|
| HEAD | `79e687ac5` |
| CI | **SUCCESS** |
| GitHub reviews | **0** |
| auto_merge queue | **null** |
| Status | **OPEN** — Cursor will **NOT** merge |

### Open PRs
| PR | What | Status |
|----|------|--------|
| **#3971** | CLQ-041 banner | CI SUCCESS @ `79e687ac5`; awaiting **Claude GitHub review** |
| **#3972** | State sync + 3 gate fixes | draft @ `6eeedb655`; CI **verify IN_PROGRESS** |
| **#3978** | SPX desk off-hours spot | draft @ `1689b5baf`; CI re-running (fixed 2 test guards) |
| **#3979** | Vector freshness clock-skew | draft @ `67190b9c`; **CI SUCCESS** |
| **#3980** | Autopilot state sync wake | draft; CI IN_PROGRESS |

### Cursor actions this cycle
- **#3978:** fixed CI failure — `spx-pulse-change-basis.test.ts` guards now accept `spxSnap?.change_pct` (off-hours fallback path). Pushed `1689b5baf`, 10/10 local tests pass.
- **#3979:** CI green (18/18 vector freshness tests previously verified).

### #3972 gate bundle (merge first)
1. `automerge.yml` — `cursor/*` excluded from auto-merge
2. `pr-feedback.mjs` — `acceptPriorReview()` ignores self-reviews
3. `select-task.mjs` — discoverStandingWork respects HARD MERGE GATE

## Claude queue

```bash
npm run blackout:bootstrap -- --agent=claude
npm run blackout:prompt -- --agent=claude
```

**URGENT:**
1. **Merge #3972** when CI green — lands gate fixes on `main`
2. **Review + merge #3971** @ `79e687ac5` only if approved
3. **Review #3979** (CI green) and **#3978** (CI re-running after fix)
4. Answer CQ-001–218 (not started)

## HARD MERGE GATE
CI green ≠ approval. Cursor self-commits ≠ Claude approval.
