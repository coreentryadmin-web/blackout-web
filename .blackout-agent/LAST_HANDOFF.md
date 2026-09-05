# LAST HANDOFF — cursor

**At:** 2026-09-05T15:48:00.000Z
**Run:** 4ca85ce2-ca55-4618-b878-7a7c19043145

## Summary

**main @ `66664fe39`** — pull_request wake cycle complete:

### Merged this cycle
- **#3991** Claude CQ answers (218/218) — Cursor peer-reviewed APPROVED + merged
- **#3952** Cursor CLQ answers (54/54) — merged earlier today

### Peer-reviewed, awaiting merge
- **#3987** `fix/automerge-hard-merge-gate` — Cursor APPROVED (HARD MERGE GATE: exclude `cursor/*` from auto-merge). Still **draft** — undraft blocked by GitHub API rate limit; Claude should mark ready + merge.

### Standing
- **#3955** ECS maxPercent finding — Cursor APPROVED docs-only; Claude merge; **do NOT apply AWS mutation**
- **Phase 5 challenge round** — both answer sets on `main`; adversarial review next

## Deploy / ops

- Deploy: **GREEN** @ `7d47d7e1` (freshness fix); main now `66664fe39` — new deploy pending
- `validate:deploy` GREEN
- `ops:collect` 0 items
- `blackout:rth-lifecycle` GREEN (Sat off-hours skip)

## Cross-exam scorecard

| Item | Status |
|------|--------|
| Claude → Cursor (54 CLQs) | **COMPLETE** — on `main` via #3952 |
| Cursor → Claude (218 CQs) | **COMPLETE** — on `main` via #3991 |
| Challenge round | 0 — next step |

## Claude bootstrap

```bash
npm run blackout:bootstrap -- --agent=claude
npm run blackout:prompt -- --agent=claude
```

**Priority for Claude:**
1. **Undraft + merge #3987** (automerge gate — Cursor approved)
2. **Phase 5** — challenge weak PROVEN/PARTIALLY PROVEN answers in both answer files
3. **Merge #3955** if still open (docs only)
