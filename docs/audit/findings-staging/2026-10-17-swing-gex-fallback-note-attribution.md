> **kind:** FINDING

## `dataHonestyCoaching`'s GEX-fallback closed-market note reads as self-contradictory when Vector is also stale — FIXED

| **Status** | FIXED |
|---|---|
| **Severity** | P3 |
| **Area** | Night Hawk Swings — `src/lib/swing/play-brief-narrative-coaching.ts`, `dataHonestyCoaching()` |
| **Found by** | Ask Largo × Night Hawk Swings standing mandate, background live health-check cycle |

### Root cause

`dataHonestyCoaching()`'s "Data caveat" bullet joins several independent staleness warnings with
" · " into one sentence. When Vector's own snapshot is stale, the function pushes
`Vector **Ns** stale` onto the warnings array, then separately falls through to
`gexMarketSessionNote()` for the orthogonal "compute is fresh but the market is CLOSED" disclosure
(correct logic — Vector and the GEX matrix are genuinely different sources, and the GEX one can be
fresh even when Vector's own snapshot is old). But `gexMarketSessionNote()`'s text
("Computed Ns ago, but the market is CLOSED...") never names which source it describes.

Live-reproduced on 3 real briefs (NVDA:62 OPEN, CRWV:61 HOLD, TSM WATCH), all at the same moment
Vector was ~3 hours stale: the bullet read `Vector **9853s** stale · HELIX pipeline stale ... ·
Computed 0s ago, but the market is CLOSED as of this read — this reflects the last session's tape,
not a live tick, however fresh the compute looks.` A member reading this sees "Vector is 9853s
stale" immediately followed by "Computed 0s ago" in the same sentence with no attribution, which
reads as the brief contradicting itself about the same data point, even though the two clauses
correctly describe two different upstream sources.

### Fix

When the closed-market note is reached via the GEX-fallback path (Vector's own note was unusable
because Vector itself is stale) AND a separate "Vector ... stale" warning is already sitting in the
same warnings array, append an explicit `(via the GEX matrix)` attribution to the fallback note so
the two age claims are legible as describing different sources. The attribution is added ONLY in
that specific combination — when Vector supplies its own `market_session_note` directly (not
stale), there is no competing "Vector ... stale" warning alongside it to disambiguate from, so no
attribution is added there (verified by the existing, unchanged
`GEX-only market_session_note surfaces when Vector gives none` and
`Vector's own closed-market note suppresses a redundant GEX one` tests, both still passing
unmodified).

### Evidence

New regression test confirmed RED against the unmodified source (`git stash` of the source fix
alone) — the attribution text was entirely absent — then GREEN restored. Full
`play-brief-narrative-coaching.test.ts` (176 tests) and `tsc --noEmit` both clean.

### Blast radius

Single function, single call site (`dataHonestyCoaching`'s one "Data caveat" bullet). No other
section duplicates this exact Vector-stale/GEX-fallback juxtaposition — the sibling CLOSED-bucket
helper (`closedMarketSessionNote`, `play-brief-absence.ts`, fixed in this session's earlier PR
#6119) doesn't have the issue because its callers never ALSO render a separate "Vector ... stale"
warning line in the same section.
