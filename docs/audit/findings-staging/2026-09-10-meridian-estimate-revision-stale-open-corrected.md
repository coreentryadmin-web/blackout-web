## 2026-09-10 — [FINDING, P3 audit-hygiene] Meridian estimate-revision-timeline defect (2026-08-18) re-verified FIXED — FINDINGS.md's OPEN status is stale — CORRECTED

> **kind:** `FINDING`

| | |
|---|---|
| **What this corrects** | `docs/audit/FINDINGS.md`'s 2026-08-18 entry **"Estimate-revision timeline is momentary, not cumulative — OPEN"** (P3, "queued as the remaining half of the estimate-revision work") has sat marked OPEN for 23 days. Live source re-verification today shows the defect was fixed 10 days after it was logged and never cross-referenced back — this entry documents the correction per the repo's own stale-OPEN convention (see the 2026-08-30 Meridian ESTIMATES/HISTORY correction entry above in this file, and #3154, which established the pattern: a new dated entry, original left intact). |
| **Original finding** | `diffEstimateRevisionTimeline` mutated its own Redis comparison snapshot as a side effect of detecting a revision, so a detected change was emitted only in the single ~20-min cached build that happened to run while the delta was fresh — any later rebuild diffed the now-current value against itself and found nothing. Measured live 2026-08-18: `estimate_revision_timeline` served 4 entries at 14:52 UTC and 0 entries at 14:57 UTC, five minutes later, same underlying data. |
| **Source confirms a real fix, not just an empty sample** | `src/lib/meridian/meridian-benzinga-analytics.ts` now carries a `mergeEstimateRevisionTimeline(live, persisted, limit)` export (added by PR #3037, 2026-08-28) whose own doc comment explicitly cites this exact defect and the exact 14:52→14:57 measurement as the reason it exists. A new `meridian_estimate_revisions` table persists every freshly-diffed entry (`UNIQUE (ticker, event_date, change_kind, revised_at)`, `ON CONFLICT DO NOTHING`), and `meridian-benzinga-earnings.ts` merges the live diff with `readRecentMeridianEstimateRevisions(since, 24)` before serving the timeline — so a build that runs after the one that first detected a revision still shows it, instead of reading empty. `FINDINGS.md` itself already carries a full, undated "## Estimate-revision timeline is momentary, not cumulative" write-up (Status: FIXED, with root cause / fix / verification sections and a 6/6 unit-test pass reproducing the exact 14:52→14:57 scenario) — it was simply never linked back to the original dated OPEN entry, so a reader scanning by date alone would still see it as outstanding. |
| **Status** | No code changed by this correction — purely closing the stale-status gap in the audit record, same as the precedent entry. |

Flagged during a DISCOVERY-lane cycle re-verifying old FINDINGS.md OPEN claims per the standing
issue-handling policy — worth noting this is the SECOND Meridian earnings-enrichment OPEN item
found stale in as many DISCOVERY cycles (the ESTIMATES/HISTORY entry corrected 2026-08-30 was the
first), suggesting Meridian's earnings-enrichment work landed in a burst that outpaced updating the
original dated entries pointing at it — worth a quick scan of nearby OPEN Meridian entries in a
future cycle in case a third one is sitting the same way.
