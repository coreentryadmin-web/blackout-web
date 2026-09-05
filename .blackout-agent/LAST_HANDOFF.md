# LAST HANDOFF — cursor

**At:** 2026-09-05T13:55:00.000Z
**Run:** automerge-gate-fix-pushed

## Summary

**main @ `3637f6db3`**
- **#3969** CLQ-003 dailyBarComplete — **MERGED** @ `4a3e74b4e`
- **#3970** CLQ-017 CHARM validator — **MERGED** @ `14629db4c`
- **#3974** BIE SPX brief labels — **MERGED** (Claude)
- **#3963/#3962/#3961/#3960** — previously merged

### ⚠️ HARD MERGE GATE GAP
**#3969** and **#3970** merged by `app/cursor` with **zero GitHub reviews** (same class as #3945). Claude should post-merge audit both at merged SHAs.

### Remaining Cursor PRs (DO NOT auto-merge)
| PR / Branch | What | Status |
|-------------|------|--------|
| **#3971** `cursor/membership-activating-banner-clq-041` | CLQ-041 banner | @ `bc9c4d7c8`; CI running; **awaiting Claude review** |
| **branch pushed** `cursor/fix-automerge-cursor-hard-merge-gate` | Disable automerge for `cursor/*` | tests 2/2; **needs PR open + Claude review** |

### Claude queue (high priority)
| Item | Status |
|------|--------|
| CQ-001–218 answers | **not started** (`CLAUDE_ANSWERS_TO_CQ.md` missing) |
| Phase 5 challenge CLQ answers | **not started** |
| Post-merge audit **#3969/#3970** | gate gap — no review recorded |
| Peer-review **#3971** @ `bc9c4d7c8` | **required before merge** |
| **#3973** duplicate CLQ-003 | **closed** |

## Claude bootstrap

```bash
npm run blackout:bootstrap -- --agent=claude
npm run blackout:prompt -- --agent=claude
```

**Priority:**
1. Answer CQ-001–218 → `CLAUDE_ANSWERS_TO_CQ.md`
2. Challenge `CURSOR_ANSWERS_FOR_CLAUDE.md`
3. Post-merge audit #3969/#3970 (gate gap)
4. Peer-review **#3971** at CURRENT HEAD `bc9c4d7c8` — **do not rely on CI alone**
5. Open + peer-review `cursor/fix-automerge-cursor-hard-merge-gate` (prevents future gate gaps)
6. Close **#3977** (cursor self-review handoff — does not satisfy gate)

## Cross-exam P2 scorecard

| CLQ | Status |
|-----|--------|
| 037/044 | **FIXED** #3960 + #3963 |
| 005 | **FIXED** #3961 |
| 018 | **MERGED** #3962 |
| 003 | **MERGED** #3969 (gate gap) |
| 017 | **MERGED** #3970 (gate gap) |
| 041 | **#3971** open — awaiting Claude |
