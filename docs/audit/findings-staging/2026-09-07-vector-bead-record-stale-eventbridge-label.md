## 2026-09-07 — [FINDING, P4 docs/hygiene] `vector-bead-record`'s `schedule_label` claimed a deployed EventBridge backup that doesn't exist — FIXED

> **kind:** `FINDING`

### Symptom

`docs/audit/FINDINGS.md`'s 2026-09-01 entry ("`vector-bead-record`'s declared '1 min EventBridge
backup' is not actually deployed") flagged this as one of two small, low-risk follow-ups someone in
`blackout-web` could pick up: fix the stale `schedule_label` in `cron-registry.ts`. It had sat OPEN
for a week with the label unchanged.

`src/lib/cron-registry.ts`'s `vector-bead-record` entry read:

```ts
schedule_label: "Every 1 min backup (market hours); in-app leader at 5s",
```

implying an independent EventBridge-triggered HTTP backup running every minute alongside the 5s
in-app primary writer.

### Investigation

Re-confirmed the underlying claim live rather than trusting the week-old finding at face value:
`boto3 events.list_rules(NamePrefix='blackout-production')` returns 47 rules today, zero of which
match `vector-bead-record` (`grep -i bead` on the rule names). What actually covers this route is
`rth-warm-leader.ts`'s in-process heal loop, which dispatches it via
`RTH_WRITER_HEAL_AFTER_MIN["vector-bead-record"] = 10/60` (10 seconds) — faster than any real
EventBridge cadence, but sharing the 5s primary's own process/Redis-leader-election failure domain
rather than an independent one, unlike every other `market_hours_only` cron in the registry.

### Fix

Corrected `schedule_label` to `"No EventBridge rule deployed — in-app leader backup only, 10s heal
threshold"`, added a doc comment explaining the deployment-topology gap and citing the live
re-confirmation, and clarified the `description` field to stop implying an independent scheduled
trigger. Added a drift-guard test (`cron-registry.test.ts`) pinning the corrected label text so a
future edit can't silently reintroduce the misleading claim without an EventBridge rule actually
being deployed first.

### Evidence

- RED→GREEN: `git stash` the label fix, new test fails (3/4 pass) against the old
  `"Every 1 min backup..."` string — restored, 4/4 pass.
- Live re-confirmation: `events.list_rules(NamePrefix='blackout-production')` → 47 rules, no
  `vector-bead-record` match.
- `src/lib/admin-cron-health.test.ts` (15/15) and
  `src/app/api/cron/cron-staleness-watchdog/route.test.ts` unaffected — neither depends on this
  label's exact text.
- `npx tsc --noEmit -p .`: clean.
- Full `npm test` (Node 20): see PR for final count.

### Blast radius

`src/lib/cron-registry.ts` (one entry's `schedule_label`/`description`, no behavior change — the
route, its auth, and its dispatch logic are all untouched) and its test file. Purely a
documentation/observability correction: nothing about what actually runs or when changes.

| **Status** | FIXED — PR opened, merge pending CI/peer-review per standing policy |
