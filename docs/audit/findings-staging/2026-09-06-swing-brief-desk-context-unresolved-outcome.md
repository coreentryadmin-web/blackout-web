> **kind:** `FINDING`

## Ask Largo swing brief's "Desk context" section rendered "closed **open**" — a live contradiction — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P3 (narrative correctness — Largo "no honest reading skipped" standard) |
| **Area** | Night Hawk Swings — Ask Largo play-brief, `play-brief-intel.ts` |
| **PR** | (pending) |

### Symptom

Found live during the 2026-09-06 5-engine monitor's standing Ask Largo deep-dive, while checking
a CLOSED bucket brief for the first time this session (`SWING:AAPL`, positionId 36, STOPPED
-56.2%). The "Desk context" section read:

```
Night Hawk's last swing on this name (2026-07-29) closed **open** — weigh that track record
against today's LONG setup before sizing.
```

`deskConsensusSection` (`play-brief-intel.ts:529`) hardcoded the word "closed" in front of
`nh.outcome`. But `outcome` is `"target" | "stop" | "open" | "ambiguous" | "pending" | "unfilled"`
(`src/features/nighthawk/lib/play-outcomes.ts:560`) — `"open"` and `"pending"` both mean the
referenced swing has **not resolved yet**, not that it closed with that value as a result. Every
other Night Hawk consumer already treats `"open"`/`"pending"` as a live/unresolved state
(`ticker-verdict.ts:154`'s `outcome === "pending"` branch, `nighthawk-edition-read.ts:811`'s
`outcome === "open"` graded-open bucket) — only this one template assumed `outcome` was always a
terminal value.

### Fix

Added an `unresolved` check (`nh.outcome === "open" || nh.outcome === "pending"`) that renders
"is still **unresolved**" instead of "closed **{outcome}**" for those two states. Terminal
outcomes (`target`/`stop`/`ambiguous`/`unfilled`) keep the existing "closed **{outcome}**" phrasing
unchanged.

### Evidence (RED → GREEN)

Added 2 tests to `play-brief-intel.test.ts` covering `outcome: "open"` and `outcome: "pending"`,
asserting the body never matches `closed **{outcome}**` and does match `still **unresolved**`.
`git stash` on `play-brief-intel.ts` alone: RED — 2/27 fail in that file. GREEN (post-fix): 27/27.

Full `src/lib/swing/*.test.ts`: 695/695 pass. `npx tsc --noEmit`: clean.

### Blast radius

Only `deskConsensusSection` in `play-brief-intel.ts`. Terminal-outcome phrasing (`target`/`stop`)
is byte-for-byte unchanged from before.
