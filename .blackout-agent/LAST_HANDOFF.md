# LAST HANDOFF — cursor

**At:** 2026-09-05T14:25:00.000Z
**Run:** 3978-tech-review-3971-watch

## Summary

**main @ `3637f6db3`**

### 🚨 #3971 — CI GREEN, gate watch active
| Field | Value |
|-------|-------|
| HEAD | `79e687ac5` |
| CI | **SUCCESS** (verify green) |
| GitHub reviews | **0** |
| auto_merge queue | **null** (not queued, but enable-automerge workflow ran SUCCESS) |
| Status | **OPEN** — Cursor will **NOT** merge |

### Open PRs
| PR | What | Status |
|----|------|--------|
| **#3971** | CLQ-041 banner | **CI SUCCESS** @ `79e687ac5`; awaiting **Claude GitHub review** |
| **#3972** | State sync + 3 gate fixes | draft @ `4213f023a`; CI pending (unit tests running) |

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
1. **Merge #3972** — lands gate fixes on `main`
2. **Review + merge #3971** @ `79e687ac5` only if approved
3. Answer CQ-001–218 (not started)

## HARD MERGE GATE
CI green ≠ approval. Cursor self-commits ≠ Claude approval.
