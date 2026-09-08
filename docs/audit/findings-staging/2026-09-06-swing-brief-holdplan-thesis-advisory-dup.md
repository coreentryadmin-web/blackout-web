> **kind:** `FINDING`

## Hold plan still repeated the thesis-health advisory sentence after #4261's recNote fix — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P3 (narrative quality — Largo "one trade-manager voice" standard) |
| **Area** | Night Hawk Swings — Ask Largo play-brief, `play-brief-intel.ts` |
| **PR** | (pending) |

### Symptom

#4261 fixed `holdPlanSection` repeating `recNote`/trim-ladder/rails/manage-engine content already
owned by `managementSection`, but left a second, same-class duplicate in the same function: the
`play.thesisHealth.advisory` sentence was rendered verbatim — the exact text
`tradeManagerNarrativeSection`'s pillar-fade narration already carries in "Trade manager read" —
and both sections render together for any live play. Confirmed still present on `main` after #4261
merged (`git checkout origin/main` + grep on `play-brief-intel.ts`):

```
lines.push(`Thesis health **${h.health}%** (${h.rungLabel}) — ${h.advisory ?? "manage per ladder"}`);
```

### Fix

Dropped the `— {advisory}` sentence suffix; kept `Thesis health **{health}%** ({rungLabel})` as a
compact number (not duplicated elsewhere), matching the same rationale as #4257's/#4261's earlier
fixes in this function.

### Evidence (RED → GREEN)

Added 1 test to `play-brief-intel.test.ts`: Hold plan no longer contains the verbatim advisory
sentence, still shows the health%/rung line. `git stash` on `play-brief-intel.ts` alone: RED —
1/21 fail in that file. GREEN (post-fix): 21/21 in that file, 36/36 across
`play-brief-intel.test.ts` + `play-brief.test.ts`.

Full `src/lib/swing/*.test.ts`: 678/678 pass. `npx tsc --noEmit`: clean.

### Blast radius

Only `holdPlanSection`. `tradeManagerNarrativeSection`'s own advisory narration is unchanged — the
sentence still appears exactly once per brief.
