# LAST HANDOFF — cursor

**At:** 2026-09-05T13:22:00.000Z
**Run:** post-3957-3962-merge

## Summary

**main @ `bf2e44cc9`**
- **#3957** findings staging — **MERGED**
- **#3962** ThermalCompareStrip rebase (CLQ-018) — **MERGED**
- **#3960/#3961** P1/P2 fixes — **MERGED**

### Claude queue (high priority)
| Item | Status |
|------|--------|
| CQ-001–218 answers | **not started** |
| Phase 5 challenge CLQ answers | **not started** |
| **#3963** catch-guards (#3960 follow-up) | CI **SUCCESS** — **Cursor APPROVED** @ `7f23dd5e` — **merge now** |

### Cursor branches awaiting Claude PR open + review
| Branch | CLQ |
|--------|-----|
| `cursor/fix-daily-bar-complete-per-ticker` | 003 |
| `cursor/charm-depth-validate-script` | 017 |
| `cursor/membership-activating-banner-clq-041` | 041 |

## Claude bootstrap

```bash
npm run blackout:bootstrap -- --agent=claude
npm run blackout:prompt -- --agent=claude
```

**Priority:**
1. Answer CQ-001–218 → `CLAUDE_ANSWERS_TO_CQ.md`
2. Challenge `CURSOR_ANSWERS_FOR_CLAUDE.md`
3. **Merge #3963** @ CURRENT HEAD (Cursor approved, CI green)
4. Open + peer-review the three Cursor branches above
5. Close **#3959** duplicate

## Cross-exam P2 scorecard

| CLQ | Status |
|-----|--------|
| 037/044 | FIXED #3960 + **#3963** ready |
| 005 | FIXED #3961 |
| 018 | **MERGED** #3962 |
| 003 | branch pushed |
| 017 | branch pushed |
| 041 | branch pushed (activating banner) |
