## 2026-10-21 — [FINDING, P2 Ask Largo x Night Hawk Swings / Largo product contract] swing play-brief Largo-contract `freshness`/`age_seconds` hardcoded on every response, ignoring known per-source staleness computed in the same code path — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|------------|-------|

### Symptom

`GET /api/market/swing/play-brief`'s top-level Largo-contract fields `"freshness"` and
`"age_seconds"` were a hardcoded `"cached"` / `null` on **every** response, regardless of whether a
genuine per-source age was actually known for that cycle.

Live repro (production, 2026-10-21): 6 real briefs sampled across OPEN/CLOSED/ROLLED buckets
(CRWV:61, CRWV:63, GOOG:59, NVDA:62, TSLA:60, AMZN:48) all returned byte-identical
`"freshness":"cached","age_seconds":null` — even though the SAME responses' own "Data freshness"
prose section disclosed genuinely different, real, already-computed ages per brief: TSLA:60 said
"Vector data **8642s** old — levels may lag live spot"; CRWV:63 said "Vector data **9209s** old";
both also carried a separately-fresh "Option mark as of 2026-10-21 12:30 ET" (~9 minutes old at
response `as_of` time). A model reading the structured Largo contract field saw no age at all for
an answer whose own prose, a few sections below it in the same response, discloses a multi-hour
stale read.

### Root cause

`adaptSwingBriefToLargo` (`src/lib/swing/play-brief-adapter.ts`, lines 145-146) hardcoded:

```ts
freshness: "cached", // Deterministic service, no live upstream
age_seconds: null, // Freshness is session-anchored, not wall-clock-age
```

on every call, regardless of input. The comment's premise was itself the bug: the swing play-brief
**compute** is deterministic, but the **data it reads** (Vector snapshot, GEX matrix, the option
mark) is not always fresh — and those per-source ages were already being computed, in the same
`composeSwingPlayBrief` call path, to build the brief's own "Data freshness" prose section
(`dataFreshnessSection`, `src/lib/swing/play-brief-intel.ts`: `vec?.dataAgeMs`,
`gexMatrixAgeMs(ctx.ecosystem?.gex_positioning, readMs)`, the option mark's own `markAsOf` age).
`adaptSwingBriefToLargo` only ever received `SwingPlayBriefResult` — a type that carried the
rendered `envelope` but never threaded any of those raw per-source ages through — so there was
nothing left for the adapter to use even if it had wanted to. This is why the hardcoded constant
went uncaught for so long: it was not a careless literal so much as a genuine plumbing gap between
where the ages are computed and where the Largo contract fields are assembled.

Per `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s C2 (freshness), the honest behavior is to surface a
known age, and fall back to omission (`null`/"cached") only when no age is genuinely knowable —
not to omit unconditionally.

### Fix

- Added `worstKnownSwingDataAgeMs(ctx)` (`src/lib/swing/play-brief-intel.ts`, next to
  `dataFreshnessSection`), which computes the worst (oldest / most load-bearing) of the EXACT same
  per-source ages the prose section already reads — the option mark's sync age (gated the same way
  `optionMarkIsStale` is: only for a live committed OPEN/HOLD/TRIM row with a real synced
  timestamp) and Vector/GEX ages (gated the same way the prose section is: `!isSwingPlayStaleCheckExempt(play)`,
  since a CLOSED or dead-WATCH play's "is today's live desk state current" question is permanently
  moot). Unlike the prose section, an age is included here whether or not it has crossed its own
  staleness bound, since a fresh age is still a genuinely KNOWN one. Returns `null` — never `0` —
  when nothing is knowable this cycle.
- Threaded the result through as a new `SwingPlayBriefResult.dataAgeMs: number | null` field
  (`src/lib/swing/play-brief-types.ts`), computed once in `composeSwingPlayBrief`
  (`src/lib/swing/play-brief.ts`) off the same `ctx`/`readMs` every other staleness check in that
  compose already uses — not a fresh, independent wall-clock sample.
- `adaptSwingBriefToLargo` now derives `age_seconds` (`Math.round(dataAgeMs / 1000)`, clamped
  non-negative) and `freshness` from that number via a new `freshnessFromAgeSeconds` helper
  (`src/lib/swing/play-brief-adapter.ts`), which reuses this desk's own EXISTING staleness bounds
  rather than inventing new ones: `<120s` → `"live"` (Vector/GEX's own stale cutoff,
  `GEX_MATRIX_STALE_MS`), `<1080s` → `"delayed"` (the option mark's own cadence-aware stale cutoff,
  `SWING_OPTION_MARK_STALE_MS`, sized for its 15-minute refresh cycle), else `"stale"` — the same
  three-bucket shape `helix-contract.ts`'s sibling `tapeFreshness` already uses for an analogous
  age -> `Freshness` mapping elsewhere in the Largo-contract surface. Falls back to the original
  honest `"cached"`/`null` ONLY when `dataAgeMs` is `null` (nothing knowable this cycle) — never
  fabricated.
- `src/app/api/market/swing/play-brief/route.ts` needed NO change — it already forwards
  `largoRead.freshness`/`largoRead.age_seconds` verbatim from the adapter's output, so fixing the
  adapter (and the plumbing feeding it) fixes the wire response too.

### Evidence

Live GET `/api/market/swing/play-brief` (production, 2026-10-21), 6 real briefs (CRWV:61, CRWV:63,
GOOG:59, NVDA:62, TSLA:60, AMZN:48) — all six returned `"freshness":"cached","age_seconds":null`
while their own "Data freshness" prose disclosed real ages (TSLA:60: "Vector data **8642s** old";
CRWV:63: "Vector data **9209s** old"). New regression test
`src/lib/swing/play-brief-adapter.test.ts` ("surfaces a known stale Vector age as
age_seconds/freshness instead of the hardcoded cached/null constant") pins the TSLA:60 number
exactly: a HOLD play with a Vector snapshot stamped `dataAgeMs: 8_642_000` now yields
`age_seconds: 8642`, `freshness: "stale"` — RED (fails: `null !== 8642`) before the fix (confirmed
via `git stash` isolating the source-file changes), GREEN after. A sibling test confirms the
honest-omission fallback (`age_seconds: null`, `freshness: "cached"`) survives unchanged for a
brief with genuinely no knowable per-source age.

### Blast radius

Single call path: `adaptSwingBriefToLargo` is the sole consumer of the new `dataAgeMs` field, and
`GET /api/market/swing/play-brief` is its sole caller. No other product adapter reads
`SwingPlayBriefResult`. `worstKnownSwingDataAgeMs` is additive (a new exported function) and does
not change `dataFreshnessSection`'s own prose output or any other existing section. `dataAgeMs` is
computed AFTER `briefContentKey`'s own snapshot is built, so it does not perturb the client refresh
dedupe key (which deliberately excludes time-only fields).

### Verify

`npx tsc --noEmit` clean; `src/lib/swing/play-brief-adapter.test.ts` (5/5),
`src/lib/swing/play-brief.test.ts` (168/168), `src/lib/swing/play-brief-intel.test.ts` (318/318)
all GREEN. Full suite run as part of this PR's CI.
