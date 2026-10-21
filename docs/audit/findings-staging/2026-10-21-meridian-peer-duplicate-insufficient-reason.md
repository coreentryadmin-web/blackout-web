## 2026-10-21 — [FINDING, swing] `meridianPeerEarningsCoaching` renders the identical thin-cohort reason twice in one bullet — Ask Largo round-3 deep-dive

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (narrative-quality — reads as a disconnected bullet-dump, not a correctness/data error) |
| **Surface** | `src/lib/swing/play-brief-meridian-peer-core.ts` — `meridianPeerEarningsCoaching()` |

### Root cause

`meridianPeerEarningsCoaching()` unconditionally pushed both `peer.position_summary` and, when
non-empty, a second caveat built from `peer.insufficient_reason` into the same `parts` array that
is joined into one "Earnings peer lens" sentence. But `position_summary` is
`describeCohortPosition()` (`src/lib/meridian/meridian-sector-core.ts`), which — whenever the
cohort has no distribution (fewer than `MIN_COHORT_PEERS` same-SIC-major-group peers) — returns
literally `${cohort.label} — ${cohort.insufficientReason}`: the SAME string that lands on
`insufficient_reason` one field over, via `shapeMeridianPeerCohortForLargo`
(`src/lib/largo/meridian-peer-cohort-for-largo-core.ts`), which sets both fields off the same
`cohort`. `distribution === null` implies both are populated with the identical reason text — there
is no code path where one is set without the other in the thin-cohort case — so the rendered
bullet stated the identical clause twice: once bare (`<Sector> — <reason>`) and again inside the
trailing `_Implied-move cohort thin: <reason> — peer beat rates are directional only._` caveat.

### Evidence

Live-reproduced in all three TSLA envelopes fetched during the round-3 deep-dive (COMMIT #60, a
WATCH short brief, and CLOSED #57) — every one rendered the clause "no peers reporting with a
comparable number — too few to rank against" twice, four clauses apart, inside the single
"Earnings peer lens" paragraph. The existing test file (`play-brief-meridian-peer.test.ts`) never
exercised this coupling: its one thin-cohort test hand-sets `position_summary: null` alongside
`insufficient_reason`, which is not how production populates the two fields (they come from the
same cohort object). Added a new test with the real coupled shape (`position_summary` carrying the
full `"${label} — ${reason}"` string, `insufficient_reason` carrying the bare reason, matching
`shapeMeridianPeerCohortForLargo`'s real output) — RED (1 fail, 9 pass — 2 occurrences of the
reason instead of 1) before the fix, GREEN (10/10) after.

### Blast radius

Single call site (`play-brief-intel.ts`'s `meridianCatalystsSection`) — no other section/route
consumes `meridianPeerEarningsCoaching()` or `position_summary` directly, so the fix is fully
contained to this one pure function.

### Fix

Guard the `position_summary` push with `peer.distribution` (only state it when the cohort actually
has a real ranking to report): `if (peer.position_summary && peer.distribution) parts.push(...)`.
The thin-cohort case still states the reason exactly once, via the existing `insufficient_reason`
caveat block a few lines below — nothing is silently dropped, the redundant copy is removed.

### Why not a bigger fix

`describeCohortPosition()`/`meridian-sector-core.ts` is a shared helper used by other, non-swing
callers where the combined `"${label} — ${reason}"` fallback string may be the only place that
reason is ever surfaced — left untouched. The fix is localized to this one swing-specific coaching
function, which already has an independent, more detailed thin-cohort caveat of its own.
