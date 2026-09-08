> **kind:** `FINDING`

## Swing play-brief HELIX flow evidence mislabeled freshness as "live" — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P2 (Largo C2 freshness contract) |
| **Area** | Night Hawk Swings — Ask Largo play-brief, `play-brief.ts` |
| **PR** | (pending) |

### Symptom

`evidenceFromContext()` stamped HELIX flow evidence with `provenance.freshness: "live"`, but the datum is a **cached window aggregate** (`print_count` over `window_hours`), not a tick-live quote. `flow_feed_fresh: true` only means the ingestion pipeline heartbeat is up — same class of bug already fixed for `envelope.levels` Vector/GEX freshness.

### Fix

Change HELIX flow evidence provenance from `freshness: "live"` → `freshness: "recent"`.

### Evidence

Extended `composeSwingPlayBrief: HELIX flow evidence carries brief asOf for Largo C1 joins` to assert `freshness === "recent"`. `npx tsx --test src/lib/swing/play-brief.test.ts`: 17/17 pass.
