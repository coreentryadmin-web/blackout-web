# Night Hawk Legacy Starved Funnel — Recurrence 2026-10-18 / 2026-10-19

**> `kind:` FINDING**

## Summary

Night Hawk Legacy edition came back `recap_only=true` with zero plays on **two consecutive nightly builds** (2026-10-18 evening for 2026-10-19 session, and 2026-10-19 evening for 2026-10-20 session).

Both incidents share the identical root cause: **100% dossier-scoring failure** — all 20 discovered candidates exited the rescore loop with `d.scored == null`, resulting in an empty `scoredList` and triggering the recap-only fallback.

## Root Cause

**File:** `src/features/nighthawk/lib/edition-builder.ts`

**Lines 933-942** (original, pre-fix):
```typescript
const scoredList = Object.values(dossiers)
  .filter((d) => d.scored != null)
  .map((d) => d.scored!);
recordScoringStageSnapshots(editionFor, "scored", scoredList, dossiers);

if (!scoredList.length) {
  // Funnel collapsed at stage_dossiers
  const reason = `No scored dossiers after staging (${candidates.length} candidate(s)).`;
  console.warn(`[nighthawk/edition] stage_dossiers zeroed — recap-only fallback: ${reason}`);
  // ... publish recap-only edition and return
}
```

The rescore loop (lines 921-931) executes `rescoreDossier()` on each dossier. If **all** calls fail or leave `d.scored == null`, the filter produces an empty list, and the funnel collapses with zero plays.

**Triggering condition:** The 2026-10-18 incident was traced to **UW rate-limiter congestion** during the rescore pass (`fetchAllDossiers` + `rescoreDossier` both call upstream UW endpoints). A transient failure that clears after a brief delay had no automatic recovery path — it required manual re-run via `POST /api/admin/nighthawk/run?asOfEt=...`.

## Evidence

**2026-10-20 17:34:59 UTC alert** (scheduled monitor trigger):
```json
{
  "edition_for": "2026-10-20",
  "published_at": "2026-10-19T21:41:46.000Z",
  "recap_only": true,
  "recap_only_reason": "No scored dossiers after staging (20 candidate(s)).",
  "funnel": {
    "candidates": 20,
    "ranked": 0,
    "dossiers": 0,
    "synthesized": 0,
    "critic_passed": 0,
    "published": 0
  },
  "no_plays": true
}
```

This is a **fresh build** from 2026-10-19 evening (not a stale cached edition), yet exhibits the exact same zero-dossier-count signature as 2026-10-18.

Two consecutive nights with identical failure mode argues this is not a transient blip but a pattern worth defensive hardening.

## Fix

**PR #6380:** Add a single bounded retry before falling back to recap-only.

**Mechanism:**
- Add `MAX_RESCORE_ATTEMPTS = 2` (initial attempt + one retry)
- After initial rescore pass: if `scoredList.length === 0`, wait 2 seconds and retry the loop once
- If still empty after retry, proceed to recap-only fallback (identical to pre-fix behavior)
- Update `recap_only_reason` to indicate retry count: `"No scored dossiers after N rescore attempt(s) (M candidate(s))."`

**Why 2 seconds?**
- UW rate-limiter congestion (the confirmed 2026-10-16 cause) typically clears in a single RTH cycle (~1-2 minutes)
- A 2-second delay is cheap insurance against transient queue timeouts without adding noticeable latency to the build
- Retry is idempotent and preserves checkpoint/resume behavior

**Why one retry?**
- Bounded — not an infinite loop
- Sufficient for transient failures (rate-limit reset, network hiccup)
- If 100% dossier failure persists after retry, it's likely a systemic issue (bad data, upstream outage) that won't be fixed by trying again

## Impact Assessment

- **Blast radius:** Night Hawk Legacy evening edition only; does not affect 0DTE or swing boards
- **User-facing:** Member sees recap-only Evening Playbook for one night instead of zero plays, then resumes normal plays the next night when the transient clears
- **Code risk:** Minimal — adds 2-second delay and re-executes identical rescore loop; all downstream behavior (recap-only fallback) unchanged if retry still fails

## Status

- **Fix:** PR #6380 (draft, awaiting test suite GREEN)
- **Deployment:** Pending CI approval
- **Validation:** Monitor 2026-10-21 evening build to confirm no regression; if 2026-10-21 publishes with plays, retry is working as intended

---

**Next step:** Merge PR #6380 once CI is green, then monitor the next two nightly builds (2026-10-21 and 2026-10-22) to confirm the retry succeeds in clearing transient failures.
