# BLACKOUT Autopilot — shared operational state

Neither Claude nor Cursor is permanent. **BLACKOUT Autopilot is permanent.**

Both agents read/write `.blackout-agent/`. Individual sessions are disposable.

## Commands

```bash
npm run blackout:bootstrap -- --agent=cursor
npm run blackout:sync
npm run blackout:claim -- --id=BO-P1-0001 --owner=cursor --phase=IMPLEMENTING
npm run blackout:heartbeat -- --agent=cursor --task=BO-P1-0001 --phase=IMPLEMENTING
npm run blackout:handoff -- --agent=cursor --summary="..."
npm run blackout:prompt -- --agent=cursor
```

## Rules

1. Claim before implement (`LOCKS/BO-*.lock`)
2. Peer review required — CI green ≠ merge approval
3. Never approve own PR
4. 90min lease default; stale locks reclaimed on sync
5. Handoff on every milestone

Audit history: `docs/audit/FINDINGS.md`. Operational index: `.blackout-agent/FINDINGS.md`.
