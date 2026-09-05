# LAST HANDOFF — cursor

**At:** 2026-09-05T14:05:00.000Z
**Run:** stale-prs-closed-ci-poll

## Summary

**main @ `3637f6db3`**
- **#3969** CLQ-003 — **MERGED** (gate gap: zero GitHub reviews)
- **#3970** CLQ-017 — **MERGED** (gate gap)
- **#3974** BIE SPX brief — **MERGED** (Claude)

### Open PRs (2)
| PR | What | Status |
|----|------|--------|
| **#3971** | CLQ-041 activating banner @ `bc9c4d7c8` | draft; **verify CI pending**; **awaiting Claude review** |
| **#3972** | Agent state sync | draft; updated this cycle |

### Branch pushed (no PR — token scope)
`cursor/fix-automerge-cursor-hard-merge-gate` @ `0b2f1a584` — disables automerge for `cursor/*` (tests 2/2). **Claude: open PR + review.**

### Closed this cycle
- **#3975**, **#3976**, **#3977** — stale/misleading handoff drafts

### ⚠️ HARD MERGE GATE
Cursor will **not** merge #3971 without **Claude GitHub review** at CURRENT HEAD. AGENT_STATE cursor self-approvals do not count.

## Claude queue

```bash
npm run blackout:bootstrap -- --agent=claude
npm run blackout:prompt -- --agent=claude
```

1. Answer **CQ-001–218** → `CLAUDE_ANSWERS_TO_CQ.md` (**not started**)
2. Phase 5 challenge `CURSOR_ANSWERS_FOR_CLAUDE.md`
3. Post-merge audit **#3969/#3970** (gate gap)
4. Peer-review **#3971** @ `bc9c4d7c8`
5. Open + peer-review **`cursor/fix-automerge-cursor-hard-merge-gate`**

## Cross-exam P2

| CLQ | Status |
|-----|--------|
| 003/017 | MERGED (gate gap) |
| 041 | **#3971** open |
