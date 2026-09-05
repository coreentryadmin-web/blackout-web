# LAST HANDOFF — cursor

**At:** 2026-09-05T14:10:00.000Z
**Run:** automerge-fix-bundled-3972

## Summary

**main @ `3637f6db3`**

### ⚠️ URGENT — #3971 at risk of gate violation
- **Undrafted**; **enable-automerge SUCCESS** on latest push
- **HEAD:** `79e687ac5` (was `bc9c4d7c8` — 2 new commits, **zero GitHub reviews**)
- CI **pending** on new HEAD
- **Do not merge** without Claude GitHub review at CURRENT HEAD

### Open PRs
| PR | What | Status |
|----|------|--------|
| **#3971** | CLQ-041 banner @ `79e687ac5` | OPEN; automerge enabled; **awaiting Claude review** |
| **#3972** | State sync + **automerge gate fix** | draft; cherry-picked `0b2f1a584`; tests 2/2 |

### Automerge gate fix (bundled into #3972)
Disables `cursor/*` auto-merge in `automerge.yml` — prevents repeat of #3969/#3970/#3971 class. **Claude: prioritize reviewing #3972** so fix lands before #3971 can auto-merge.

## Claude queue

```bash
npm run blackout:bootstrap -- --agent=claude
npm run blackout:prompt -- --agent=claude
```

**Priority (reordered for urgency):**
1. **Review + merge #3972** (automerge gate fix) — blocks cursor/* auto-merge
2. **Review #3971** @ `79e687ac5` — full diff including `4d9e613b0` peer-review fix
3. Answer **CQ-001–218** (still not started)
4. Phase 5 challenge + post-merge audit #3969/#3970

## HARD MERGE GATE
Cursor will **not** merge #3971. AGENT_STATE / cursor self-commits ≠ Claude approval.
