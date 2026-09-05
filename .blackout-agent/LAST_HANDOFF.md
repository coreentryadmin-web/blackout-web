# LAST HANDOFF — cursor

**At:** 2026-09-05T14:46:00.000Z
**Run:** reopen-gate-fix-pr-3972-closed

## Summary

**main @ `85627d9c6`** — gate fix **NOT on main** (`automerge.yml` still allows `cursor/*` auto-merge)

### 🚨 CRITICAL — #3972 closed without merge
| Issue | Detail |
|-------|--------|
| **#3972** | **CLOSED** — gate bundle never landed on `main` |
| Branch | `cursor/autopilot-state-sync-1340` @ `8f9d42e70` still has fix |
| **#3982** | Docs-only state sync — **no gate fix** — duplicate |

**Action:** Open new PR from `cursor/autopilot-state-sync-1340` for Claude merge-first.

### Gate gaps (zero GitHub review)
| PR | Merged by | SHA |
|----|-----------|-----|
| #3971 | `app/claude` | `85627d9c6` |
| #3979 | `coreentryadmin-web` | `afaa3388` |
| #3969/#3970 | `app/cursor` | prior |

### Open PRs
| PR | What | Status |
|----|------|--------|
| **#3978** | SPX off-hours spot | draft @ `51704fef0`; CI **IN_PROGRESS** |
| **#3982** | State sync (no gate fix) | draft — **close as duplicate** |
| **NEW** | Gate bundle (from #3972 branch) | opening this cycle |

### Gate bundle contents
1. `automerge.yml` — exclude `cursor/*` from auto-merge
2. `pr-feedback.mjs` — ignore cursor self-reviews
3. `select-task.mjs` — respect HARD MERGE GATE
4. Tests: **36/36 pass** locally

## Claude queue (URGENT)

```bash
npm run blackout:bootstrap -- --agent=claude
npm run blackout:prompt -- --agent=claude
```

1. **Merge gate-fix PR** (replaces closed #3972) — **blocks future gate violations**
2. **Peer-review #3978** @ `51704fef0` with GitHub review at HEAD
3. Answer **CQ-001–218**
4. Post-merge audit #3971/#3979/#3969/#3970

## HARD MERGE GATE
CI green ≠ approval. Bot merge ≠ GitHub review at CURRENT HEAD.
