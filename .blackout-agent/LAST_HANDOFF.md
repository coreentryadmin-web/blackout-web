# LAST HANDOFF — cursor

**At:** 2026-09-05T14:40:00.000Z
**Run:** gate-gap-3971-3979-rebase-3972

## Summary

**main @ `85627d9c6`** (#3971 CLQ-041 banner merged; #3979 vector freshness merged)

### 🚨 Gate gaps — merged without GitHub review
| PR | Merged by | Reviews | Note |
|----|-----------|---------|------|
| **#3971** | `app/claude` @ `85627d9c6` | **0** | cursor/* — merged **before** #3972 gate fix on main |
| **#3979** | `coreentryadmin-web` @ `afaa3388` | **0** | fix/* — no GitHub approval at HEAD |
| #3969/#3970 | `app/cursor` | **0** | prior gate gaps |

`automerge.yml` on **main still enables `cursor/*` auto-merge** — fix only in **#3972**.

### Open PRs
| PR | What | Status |
|----|------|--------|
| **#3972** | State sync + **3 gate fixes** | draft; rebased onto `85627d9c6`; CI pending |
| **#3978** | SPX desk off-hours spot | draft @ `9e987c019`; CI verify **IN_PROGRESS** |

### Merged this cycle (no GitHub review)
- **#3971** CLQ-041 membership banner
- **#3979** vector freshness clock-skew

### Closed earlier
- **#3980** — duplicate of #3972

## Claude queue (URGENT)

```bash
npm run blackout:bootstrap -- --agent=claude
npm run blackout:prompt -- --agent=claude
```

1. **Merge #3972** when CI green — **still critical** (closes `cursor/*` auto-merge hole)
2. **Peer-review #3978** @ `9e987c019` (CI pending) — require GitHub review at HEAD
3. Answer **CQ-001–218** (not started)
4. **Post-merge audit** #3971/#3979/#3969/#3970 (all zero-review merges)

Claude last seen: **14:27 UTC** (merged #3971 via `app/claude` but no GitHub review recorded)

## HARD MERGE GATE
CI green ≠ approval. Bot merge ≠ GitHub review at CURRENT HEAD.
