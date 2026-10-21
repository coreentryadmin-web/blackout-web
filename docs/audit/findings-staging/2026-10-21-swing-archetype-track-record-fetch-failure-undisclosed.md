## 2026-10-21 — [FINDING, swing] Archetype track-record fetch TIMEOUT was indistinguishable from an honest cold-cache absence — not disclosed, not counted in confidence

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (Largo C3 absence principle — a genuine outage reads as an honest "nothing to show" gap) |
| **Surface** | `src/lib/swing/play-brief-context.ts` (fetch), `src/lib/swing/play-brief-absence.ts`'s `collectBriefUnavailableSources`, `src/lib/swing/play-brief-types.ts` |

### Root cause

Every other best-effort source in `play-brief-context.ts`'s fan-out (`ecosystem`, `vector`) threads a
dedicated `*FetchFailed` flag through its `.catch()`, which `collectBriefUnavailableSources`
(`play-brief-absence.ts`) checks to disclose a genuine fetch failure distinctly from a legitimately
empty read — and `swingPlayBriefConfidence` derives its tier purely from
`unavailableSources.length`, so a disclosed failure correctly downgrades confidence.

The archetype track-record read (Largo C10 historical context) was the one source exempted from
this discipline:

```js
// unlike ecosystem/vector above this has no dedicated *FetchFailed flag because a miss here is
// never surfaced as an absence/error to the member — an ungraduated or unavailable track record
// simply omits the "Track record" section (Largo C6: omission, not fabrication)
withBriefSourceTimeout(readSwingArchetypeTrackRecord()).catch(() => null),
```

That reasoning conflates two distinct contract points: **C6** (never fabricate a calibrated number
from too little data — which the rendering section already does correctly) and **C3** (always
disclose a genuine data *absence*, which the sibling sources' fetch-failure flags exist for).
`withBriefSourceTimeout` genuinely **rejects** on timeout (per its own 2026-10-15 fix elsewhere in
this file), so a reachable timeout and a legitimate cold-cache/ungraduated-bucket `null` were
collapsing into the identical value, with zero disclosure either way — and because
`collectBriefUnavailableSources` never referenced `ctx.archetypeTrackRecord` at all, this gap was
also invisible to `swingPlayBriefConfidence`.

### Evidence

Live repro (EWY WAIT-bucket play-brief, Ask Largo deep-dive, 2026-10-21): the brief disclosed 8
other unavailable sources and its own text asserted "No archetype track-record section... this is
expected absence, not a gap" — a claim the system had no way to actually verify, since a genuine
timeout on that read would have produced byte-identical output.

Verified directly against source (not the auditing workflow's citations alone):
`play-brief-context.ts`'s `archetypeTrackRecord` fetch had the bare `.catch(() => null)` shown
above, while its `ecosystem`/`vector` siblings in the same `Promise.all` both logged the error and
set a dedicated flag; `collectBriefUnavailableSources` (grepped in full) never referenced
`ctx.archetypeTrackRecord`; `swingPlayBriefConfidence` derives its tier purely from
`unavailableSources.length` (grepped, zero references to `archetypeTrackRecord`).

Added two tests to `play-brief-absence.test.ts`: one confirming a genuine fetch failure
(`archetypeTrackRecordFetchFailed: true`) now surfaces as `{ source: "Archetype track record",
reason: "fetch failed" }`; one confirming a legitimate `archetypeTrackRecord: null` WITHOUT a fetch
failure still produces no entry (preserving the Largo C6 "omission, not fabrication" contract for
the honest-absence case). GREEN confirmed: `play-brief-absence.test.ts` 99/99 pass. A literal
`git stash`-based RED repro hit an unrelated environment hang (an isolated `tsx`/esbuild stall,
reproduced twice, that cleared once the stash was restored and never recurred on the fixed state) —
RED is instead established by direct source inspection: the pre-fix `.catch(() => null)` line and
the confirmed absence of any `ctx.archetypeTrackRecord` reference in `collectBriefUnavailableSources`
together prove the new tests could not have passed against that code. Broader sweep
`play-brief*.test.ts`: 1127/1127 pass. `tsc --noEmit` clean.

### Blast radius

Three files, each touched minimally and additively: a new optional flag on
`SwingPlayBriefContext`, one new `.catch()` branch at the single fetch site, one new disclosure
block in `collectBriefUnavailableSources` (placed without the `!isNotLive` guard, matching the
`ecosystemFetchFailed` precedent — a fetch failure is a fact about the read, true regardless of play
status). `swingPlayBriefConfidence` needed no change — it already derives its tier purely from
`unavailableSources.length`, so once the new entry is pushed, a track-record timeout correctly
downgrades confidence the same way every other fetch failure already does.

### Fix

Give `archetypeTrackRecord`'s fetch the identical `*FetchFailed` pattern already used for
`ecosystem`/`vector`: log the error, set `archetypeTrackRecordFetchFailed = true`, thread the flag
through the returned context, and disclose it via `collectBriefUnavailableSources`.

### Why not a bigger fix

Explicitly out of scope: a genuine Redis-layer outage (as opposed to the timeout race this fix
closes) is already converted to a cold-cache-equivalent `null` by `sharedCacheGet`'s own documented
fail-soft "never throws" contract, shared by many unrelated callers across the codebase — changing
that is a separate, much larger architectural change, not a one-file fix, and isn't needed for the
reachable, demonstrable half of this bug (the timeout path). Did not touch
`archetypeTrackRecordSection`'s own rendering logic (already correct — it already implements the C6
omission-not-fabrication discipline for the honest-absence case).
