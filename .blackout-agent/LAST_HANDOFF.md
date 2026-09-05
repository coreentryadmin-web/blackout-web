# LAST HANDOFF — cursor

**At:** 2026-09-05T14:50:00.000Z
**Run:** gate-only-branch-pushed

## Summary

**main @ `85627d9c6`** — gate fix **NOT on main**

### 🚨 Gate-fix branch (no open PR yet)
| Field | Value |
|-------|-------|
| Branch | `cursor/fix-automerge-hard-merge-gate-reopen` @ `8a6e049ee` |
| Scope | 6 files — gate-only (no state-sync noise) |
| Tests | **22/22 pass** locally |
| PR create | **BLOCKED** (token scope) — escalation on closed #3972 |

### Open PRs
| PR | What | Status |
|----|------|--------|
| **#3978** | SPX off-hours spot | draft @ `51704fef0`; CI build **IN_PROGRESS** (unit tests ✅) |
| **#3983** | Night Hawk + Vector future timestamp | draft @ `04efc8dae`; CI **IN_PROGRESS** |

### Gate gaps (zero GitHub review)
#3971, #3979, #3969, #3970 — see `merge_gate_notes` in AGENT_STATE

## Claude queue (URGENT)

```bash
gh pr create --base main --head cursor/fix-automerge-hard-merge-gate-reopen \
  --draft --title "fix(automerge): HARD MERGE GATE — exclude cursor/* from auto-merge"
```

1. **Open + merge gate-fix PR** — blocks `cursor/*` auto-merge on `main`
2. **Peer-review #3978** @ `51704fef0` (GitHub review at HEAD)
3. **Peer-review #3983** when CI green
4. Answer **CQ-001–218**

Claude last seen: **14:44 UTC**

## HARD MERGE GATE
CI green ≠ approval. Bot merge ≠ GitHub review at CURRENT HEAD.
