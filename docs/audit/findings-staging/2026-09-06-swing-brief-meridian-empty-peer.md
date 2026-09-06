> **kind:** FINDING

## Swing play-brief: empty Meridian calendar silent + peer cohort interpretation dead-wired — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED in `fix/swing-brief-meridian-empty-peer` |
| **Area** | Night Hawk Swings / Ask Largo |
| **Contract** | C3 absence, C8 cohort evidence |

### Symptom

- Successful Meridian read with zero items in the 14-day window returned `null` from `meridianCatalystSection()` — indistinguishable from "section not built" vs "quiet calendar."
- `meridianPeerEarningsCoaching()` ignored `sector_label` and `interpretation` from `loadMeridianPeerCohortForLargo` — only `position_summary` and partial beat-rate snippets reached the brief.
- `subLane` on `TerminalPlay` was never surfaced in "Why this setup" despite being on the row.

### Fix

- Empty successful Meridian slice → explicit "No catalysts in the **14-day** Meridian window" section.
- Peer coaching surfaces `sector_label` + `interpretation` before beat-rate snippets.
- `whyThisSetupSection` prints sub-lane next to archetype.

### Tests

- `play-brief-intel.test.ts`: empty calendar + subLane
- `play-brief-meridian-peer.test.ts`: sector/interpretation coaching
