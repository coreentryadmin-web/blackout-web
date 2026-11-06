> **kind:** FINDING

## Cron audit `query`: spx-evaluate / spx-issues-sync vs engine window (7:00–16:15 ET)

| **Status** | FIXED |

### What was broken

`evaluateJob` used **cash RTH** (`isEtCashRth`, 9:30–16:00 ET) for `market_hours_only` off-window stale suppression. **`spx-evaluate`** and **`spx-issues-sync`** routes gate on **`isSpxEngineCronWindow`** (7:00–**16:15** ET weekdays), matching post-close force-flatten.

**Premarket:** 6:30 AM ET — cash RTH false but engine still off-window — long skip streak read as **stale** → **`cron-audit-query`** P0.

**Post–16:00 ET:** With only cash-RTH logic, **16:00–16:15** could be misclassified relative to route skips (watchdog `problems` included both keys in failing runs; see CI `Cron audit query` 2026-11-06).

### Fix

`marketHoursCronOffWindow()`: for `spx-evaluate` and `spx-issues-sync`, use **`!isSpxEngineCronWindow`**, not `!isEtCashRth`. Heartbeat override for `spx-evaluate` uses the same helper for `offWindow`.

### Market-open check

- **Premarket:** before 7:00 AM ET — skip handshake should stay **healthy** (not stale) if last run is expected skip.
- **Post-close grace:** 16:05–16:14 ET — if last run is a legitimate skip after cash close, watchdog must not treat as stale solely because cash RTH ended at 16:00.
