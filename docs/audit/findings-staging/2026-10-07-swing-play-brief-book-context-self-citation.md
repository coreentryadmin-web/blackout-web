## Swing play-brief "Book context" self-cites a reviewed position as "a separate overlap" whenever a ticker carries 2+ concurrent same-direction positions — fix/swing-play-brief-book-context-self-citation — 2026-10-07

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 — Ask Largo standing mandate (ongoing Night Hawk Swings deep-dive). Member-facing narrative defect: the "Book context" concentration/conflict callout can cite the reviewed play's own position as if it were an independent overlapping bet, which is the opposite of what that section exists to warn about. |

**What was broken (live-confirmed, 2026-10-07, ~12:40-12:50 UTC, pre-open 5-engine monitor cycle):**
`GET /api/market/swing/play-brief` for a ticker carrying two concurrent same-direction positions
rendered the SAME "Book context" citation regardless of which of the two positions was being
reviewed. Live repro on SG (two real concurrent LONG calls, 9C entry $0.33 and 9.5C entry $0.23,
confirmed via the brief's own independently-correct "Other concurrent position(s)" section):

- `?playId=SWING:SG&ticker=SG&strike=9&right=C` (reviews the 9C leg) → Book context: *"already
  holding 1 same-direction position in the same name (SG): SG LONG (separate, cross-engine
  position #1396)."*
- `?playId=SWING:SG&ticker=SG&strike=9.5&right=C` (reviews the 9.5C leg) → Book context:
  **the identical text**, citing the identical banger id **#1396**.

A single fixed `banger_positions.id` cannot correctly represent "the other position" in both
reviews at once — in at least one of the two, the section was citing the reviewed play's OWN
position back at itself as if it were a separate, independently-held bet. The "Other concurrent
position(s)" section (built from `laneRows`, a different code path) correctly named the true other
leg in both directions, proving Book-context specifically was wrong, not the underlying data.

**Root cause:** `resolveSwingPlayForBrief`'s lane-play branch (`src/lib/swing/play-brief-resolve.ts`)
builds the final `TerminalPlay` via `horizonRowToDeckSource(enriched)` — called with only the
`HorizonPlay`, no second argument. `horizonRowToDeckSource`'s own body does
`positionId: positionId ?? null`, reading ONLY the (omitted) parameter — never `p.positionId`,
even though `enriched.positionId` already carries the real, correctly-resolved id (banger's
`banger_positions.id`, or a real `swing_positions.id`; `pickLanePlayForBrief` already resolves the
SPECIFIC leg when a positionId/strike/right hint disambiguates one — proven by the existing
2026-09-21 ABTC test in `play-brief-resolve.test.ts`). The dropped field meant the resolved
`TerminalPlay.id` (`${horizon}:${ticker}${positionId ? ":"+positionId : ""}`) never carried a
positionId suffix for ANY lane-resolved play. `bookContextSection`
(`src/lib/swing/play-brief-intel.ts`) parses that id back via `parseSwingPlayId` to get
`excludePositionId` for `checkPortfolioOverlap`'s identity-based self-exclusion
(`src/lib/swing/portfolio.ts`) — with it always null, self-exclusion silently fell back to
`excludeSelfMatch: true`'s **first ticker+direction match found while iterating `existing`**,
which is DB-query-order-dependent (`fetchBangerOpenBookRows`'s `ORDER BY session_date DESC, id
DESC`), not identity-based. Whichever of the two same-ticker rows happens to sort first always
gets excluded as "self," regardless of which one is actually under review — so reviewing the
*other* one incorrectly leaves its own row in the comparison set, which then renders as "a
separate position."

This is the same underlying-disease class as three prior fixes already documented inline in
`play-brief-intel.ts` (Largo C4, 2026-09-15/09-18/09-20 — each patched a symptom of ambiguous/
duplicate overlap citations) and the exact scenario #5. unification-fix comment in
`banger-lane-merge.ts`/`play-brief-resolve-pure.ts` (2026-09-21, ABTC) already describes for a
*different* call site (`pickLanePlayForBrief` itself) — but none of them closed this specific gap,
because they all assumed `positionId` correctly reaches `bookContextSection` once resolution picks
the right `HorizonPlay`. It does pick the right one; the bug is one step later, in how that pick
gets turned into the `TerminalPlay` the rest of the brief (including `bookContextSection`) reads.

**What changed:** `src/lib/swing/play-brief-resolve.ts` — the lane-play branch now passes
`enriched.positionId ?? null` as `horizonRowToDeckSource`'s second argument, mirroring what
`loadOpenTerminalPlay` (a few lines up in the same file) already does for the swing-ledger-only
path. No other logic changed.

**Blast radius:** Every lane-resolved play (banger-origin or swing-native) that goes through
`resolveSwingPlayForBrief`'s `pickLanePlayForBrief` branch — i.e. every OPEN/HOLD/TRIM/WATCH swing
play-brief that isn't resolved via the separate `loadOpenTerminalPlay`/`loadClosedPlay` paths (those
already passed `row.id` correctly). The defect was silent (no error, no missing section) and only
externally OBSERVABLE when a ticker carries 2+ concurrent same-ticker-same-direction positions —
confirmed live as a routine occurrence today: SG, SPCH, TSLL, SPCX, COHR, and AAOI all carried
duplicate-ticker committed positions on today's board (`GET /api/market/nighthawk/horizons?
view=swings`). Also fixes the identical class of ambiguity for any FUTURE duplicate — this was not
a per-ticker patch.

**Fix rationale:** Minimal, one-line-plus-comment change at the exact point the field was dropped,
mirroring the sibling call site's already-correct pattern rather than inventing a new identity
mechanism. Left `horizonRowToDeckSource`'s own signature/body untouched (it already correctly reads
whatever `positionId` argument it's given) — the bug was purely a missing argument at one call
site, not a defect in the function itself.

**Evidence:** New regression test
`src/lib/swing/play-brief-resolve.test.ts` ("resolveSwingPlayForBrief: a lane-resolved play
(banger-origin or swing-native) keeps its own positionId") — RED pre-fix (`resolved.play.id` came
back `"SWING:SG"` with no positionId suffix for either leg, confirmed via `npx tsx
--experimental-test-module-mocks --test` on the unmodified file), GREEN post-fix (`"SWING:SG:1396"`
and `"SWING:SG:1450"` respectively). `npx tsc --noEmit` clean. Full
`src/lib/swing/play-brief*.test.ts` + `src/features/nighthawk/command-deck/adapters.test.ts`
(969 tests) pass unchanged. Full `npm test` run in progress at write time; see PR for final count.
