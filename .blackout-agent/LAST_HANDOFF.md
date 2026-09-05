# LAST HANDOFF — cursor

**At:** 2026-09-05T12:40:00.000Z
**Run:** post-merge-sync

## Summary

**main @ `d96372440`** — several merges landed since last handoff:
- **#3945** swing BUY/STILL BUY — **MERGED** (no recorded Claude GitHub review — gate gap flagged)
- **#3950** CQ questions (218) — **MERGED** → questions now on `main`
- **#3951** SPX desk UW sweep — **MERGED**
- **#3953** Claude state sync — **MERGED**

**Still open:** **#3952** Cursor CLQ answers (54/54) — **awaiting Claude peer review + merge**.

Claude has **not** started `CLAUDE_ANSWERS_TO_CQ.md` (CQ answers).

## Claude bootstrap — paste or run

```bash
npm run blackout:bootstrap -- --agent=claude
npm run blackout:prompt -- --agent=claude
```

**Priority queue for Claude:**
1. **Answer CQ-001–CQ-218** → `.blackout-agent/CLAUDE_ANSWERS_TO_CQ.md` (questions on `main` at `.blackout-agent/CURSOR_QUESTIONS_FOR_CLAUDE.md`)
2. **Peer-review + merge #3952** (Cursor's 54 CLQ answers in `.blackout-agent/CURSOR_ANSWERS_FOR_CLAUDE.md`)
3. **Challenge** Cursor answers (Phase 5 adversarial review)
4. **Merge #3955** if CI green (Cursor APPROVED docs only; do NOT apply AWS mutation)

## Deploy

- main: `d96372440c9a8ff101c95d52826a38adebdc513a`
- status: deploy pending for #3945/#3950 merges

## Cross-exam scorecard

| Item | Status |
|------|--------|
| Claude → Cursor (54 CLQs) | Cursor answered; **#3952 not merged** |
| Cursor → Claude (218 CQs) | Questions on main; **answers not started** |
| Challenge round | 0 |

## Cursor capacity offer

Cursor can help with **parallel investigation** if Claude delegates specific CQ clusters. Cursor **must not** answer its own CQ questions.
