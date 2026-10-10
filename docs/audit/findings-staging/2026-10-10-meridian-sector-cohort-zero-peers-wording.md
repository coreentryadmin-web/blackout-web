## 2026-10-10 — [FINDING, P4 Largo/Meridian] Sector-cohort "insufficient peers" message read "only 0 peers reporting" when the true count was zero — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | Live swing play-briefs for LRN (Education sector) and CLF (Metals & Mining sector), 2026-10-10, both rendered their "Earnings peer lens" section's thin-cohort note as **"only 0 peers reporting with a comparable number — too few to rank against."** The phrasing reads as if some peers exist but not enough ("only 0" is self-contradictory phrasing), when the true state is simply no comparable peers at all. |
| **Root cause** | `buildSectorCohort` (`src/lib/meridian/meridian-sector-core.ts`) builds its `insufficientReason` from one template for every count below `MIN_COHORT_PEERS` (4): `` `only ${values.length} peer${values.length === 1 ? "" : "s"} reporting with a comparable number — too few to rank against` ``. That phrasing is fine for N=1..3 but grammatically confusing at N=0. |
| **Why not caught earlier** | The existing regression test (`meridian-sector-core.test.ts`, "a cohort below the peer floor...") only exercised N=2 peers; N=0 was never a tested case, and it is the live repro (both LRN's Education and CLF's Metals & Mining sectors had zero comparable peers in the loaded Meridian window at the time of this read). |
| **Fix** | Special-case `values.length === 0` to the plain, unambiguous "no peers reporting with a comparable number — too few to rank against," leaving the existing "only N peer(s)..." wording unchanged for N=1..3. |
| **Blast radius** | Single call site (`buildSectorCohort`); its only consumer, `src/lib/largo/meridian-peer-cohort-for-largo-core.ts`, passes `insufficientReason` straight through as a plain string field (`insufficient_reason`) with no pattern-matching on its content — checked, no downstream test or code string-matches the old "only N" phrasing in a way the fix breaks. |
| **Regression guard** | `src/lib/meridian/meridian-sector-core.test.ts` — new test builds a cohort with zero peers and asserts the exact "no peers reporting..." string, and that it never contains "only 0". RED→GREEN proven via `git stash` isolating the test from the production fix. |
| **Gates** | `npx tsc --noEmit` clean (Node 20.20.2) · `meridian-sector-core.test.ts` + `meridian-peer-cohort-for-largo-core.test.ts` + `play-brief-intel.test.ts` 240/240 pass · full `npm test` run alongside this write-up. |
| **Status** | FIXED — see PR. |
