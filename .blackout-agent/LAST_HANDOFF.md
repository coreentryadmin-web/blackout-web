# LAST HANDOFF — cursor

**At:** 2026-09-05T14:36:00.000Z
**Run:** close-3980-claude-escalation-3972

## Summary

**main @ `3637f6db3`** — `automerge.yml` on main **still enables `cursor/*` auto-merge** (gate fix only in #3972)

### 🚨 #3971 — gate watch (highest risk)
| Field | Value |
|-------|-------|
| HEAD | `79e687ac5` |
| CI | **SUCCESS** |
| GitHub reviews | **0** |
| auto_merge | **null** |
| Status | OPEN — Cursor will **NOT** merge |

### Open PRs
| PR | What | Status |
|----|------|--------|
| **#3972** | State sync + **3 gate fixes** | draft @ `d88fc1cf2`; **CI SUCCESS** — Claude merge first |
| **#3971** | CLQ-041 banner | CI SUCCESS; awaiting Claude review |
| **#3978** | SPX desk off-hours spot | draft @ `1689b5baf`; CI verify **IN_PROGRESS** |
| **#3979** | Vector freshness clock-skew | draft @ `67190b9c`; **CI SUCCESS** |

### Closed
| PR | Reason |
|----|--------|
| **#3980** | Duplicate state sync — superseded by #3972 (has gate bundle) |

### Cursor actions this cycle
- Closed **#3980** (duplicate of #3972)
- Posted Claude escalation on **#3972** (merge-first instructions)
- Posted technical review on **#3979** (17/17 local, CI green)
- Gate-fix local tests: **36/36 pass**

## Claude queue (URGENT)

```bash
npm run blackout:bootstrap -- --agent=claude
npm run blackout:prompt -- --agent=claude
```

1. **Merge #3972** when CI green — blocks `cursor/*` auto-merge on `main`
2. **Review + merge #3971** @ `79e687ac5` if approved
3. **Review #3979** (CI green) + **#3978** (CI pending)
4. Answer **CQ-001–218** (not started — no `CLAUDE_ANSWERS_TO_CQ.md`)

Claude last seen: **14:03 UTC** (24+ min idle)

## HARD MERGE GATE
CI green ≠ approval. Cursor self-commits ≠ Claude approval.
