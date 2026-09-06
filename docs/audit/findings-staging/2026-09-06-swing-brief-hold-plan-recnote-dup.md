> **kind:** `FINDING`

## Ask Largo swing brief repeated `recNote` in Management and Hold plan — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P3 (narrative quality — same class as #4257) |
| **Area** | Night Hawk Swings — Ask Largo play-brief, `play-brief-intel.ts` |
| **PR** | (pending) |

### Symptom

Follow-on from #4257 (`whyThisSetupSection` recNote dup). For open-bucket plays,
`managementSection` (`play-brief.ts:64`) already renders `recNote` verbatim. `holdPlanSection`
(`play-brief-intel.ts:407`) pushed the same string again, so every HOLD/OPEN brief with a `recNote`
showed it twice — once under **Management**, once under **Hold plan**.

### Fix

Removed the duplicate `recNote` push from `holdPlanSection`. Hold plan still carries desk stance,
DTE, earnings risk, trim ladder, and thesis-health coaching — its stated job.

### Evidence (RED → GREEN)

- `holdPlanSection` unit test: section body must not contain verbatim `recNote`
- `composeSwingPlayBrief` integration test: `recNote` appears in exactly one section (`Management`)
- `play-brief-intel.test.ts` + `play-brief.test.ts`: 34/34 pass

### Blast radius

`holdPlanSection` only. `managementSection` unchanged — note still appears exactly once per brief.
