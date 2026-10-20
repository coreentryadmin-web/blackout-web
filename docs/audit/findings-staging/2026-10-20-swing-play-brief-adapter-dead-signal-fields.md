## `src/lib/swing/play-brief-adapter.ts` — `SwingPlayBriefSignal` declares 8 fields the adapter never populates and nothing ever reads

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | REPORTED, NOT FIXED — flagged for the swing play-brief/Largo-contract owner to decide wire-up vs retire; not unilaterally touched (same precedent as `composite-confidence.ts`, WS-22/`flow-amendment.ts`, the x-intel trio, and `meridian-play-suggestions.ts` below in FINDINGS.md) |
| **Severity** | P4 (dead-weight type surface, not a runtime defect — no user-facing impact; nothing currently expects these fields to be present) |
| **Surface** | `src/lib/swing/play-brief-adapter.ts` (`SwingPlayBriefSignal` type + `adaptSwingBriefToLargo()`) |

### What it is

`adaptSwingBriefToLargo()` is the Largo-contract adapter for the deterministic Swing Play
Intelligence brief (`GET /api/market/swing/play-brief`), transforming the UI-facing
`SwingPlayBriefResult`/`BieAnswerEnvelope` into a `ProductRead<SwingPlayBriefSignal>` per
`docs/audit/LARGO-PRODUCT-CONTRACT.md`. The `SwingPlayBriefSignal` type declares 8 optional
fields clearly intended to carry structured swing-position context for Largo/aggregation
consumers:

```ts
export type SwingPlayBriefSignal = ProductSignal & {
  archetype?: string;
  sub_lane?: string;
  entry_premium?: number;
  peak_premium?: number | null;
  bucket?: string;
  thesis_strength_pct?: number | null;
  grade?: string;
  invalidation?: string | null;
  narrative?: string;
};
```

### Evidence it's dead

`adaptSwingBriefToLargo()`'s own `signal` object (lines 110-126) only ever sets `ticker`,
`ticker_class`, `direction`, `evidence`, `native`, and `narrative` — never `archetype`,
`sub_lane`, `entry_premium`, `peak_premium`, `bucket`, `thesis_strength_pct`, `grade`, or
`invalidation`. This isn't an oversight at the call site alone: `SwingPlayBriefResult`
(`play-brief-types.ts`) — the adapter's only input — has no typed fields of those names at all
(`playId`, `ticker`, `ticker_class`, `envelope`, `asOf`, `sessionDate`, `engine`, `flowSnapshot`,
`briefContentKey`, `trimsFired`). The envelope itself is UI-facing markdown/sections/levels, not a
structured source for a position's archetype/sub_lane/bucket/grade. The adapter has nothing to
populate these 8 fields FROM, which is why it never does.

Repo-wide grep for every consumer that could read them off the adapter's output:

```
$ grep -rn "largoRead\.data\.\|signal\.archetype\|signal\.sub_lane\|signal\.entry_premium\|\
  signal\.peak_premium\|signal\.bucket\|signal\.thesis_strength_pct\|signal\.grade\|\
  signal\.invalidation" --include="*.ts" --include="*.tsx" .
src/app/api/market/swing/play-brief/route.ts:106   largoRead.data.direction
src/app/api/market/swing/play-brief/route.ts:108   largoRead.data.evidence
src/lib/swing/play-brief-adapter.test.ts           largoRead.data.ticker_class (x4)
```

The ONLY `signal`/`largoRead.data` fields any caller ever reads are `direction`, `evidence`, and
`ticker_class` — all three of which ARE populated. Zero references anywhere to `.archetype`,
`.sub_lane`, `.entry_premium`, `.peak_premium`, `.bucket`, `.thesis_strength_pct`, `.grade`, or
`.invalidation` on this type. Separately, the route handler itself (`play-brief/route.ts`
lines 94-115) only forwards a hand-picked subset of `largoRead`'s top-level meta fields
(`as_of`/`freshness`/`age_seconds`/`direction`/`evidence_numbers`/`source`/`cohort`) into the HTTP
response — it never spreads `largoRead.data` wholesale, so even the fields the adapter DOES
populate (`native`, `narrative`) never reach the wire either (`ticker`/`ticker_class` do reach it,
but redundantly — via the separate `...brief` spread a few lines above, not via `largoRead.data`).

Note: `archetype` and `sub_lane` are NOT dead concepts in the swing engine generally — they're
real, actively-used DB columns (`swing_positions.sub_lane`/`.archetype`, read/written throughout
`commit.ts`, `feature-vector.ts`, `calibration.ts`, `closed-plays.ts`, `live-plays.ts`, etc.). The
dead part is narrowly this ONE type's declaration of same-named fields with no path to ever
receive that real data, because this adapter's only input (`SwingPlayBriefResult`) was never
extended to carry a position row alongside the envelope.

### Why reported, not fixed

Same shape this file has repeatedly flagged and declined to unilaterally resolve:
`composite-confidence.ts` (zero importers 3 months after shipping), `flow-amendment.ts` (WS-22),
the x-intel trio, and `meridian-play-suggestions.ts`. Wiring these 8 fields up for real would mean
threading a `SwingPositionRow` (or equivalent) into `composeSwingPlayBrief`/`SwingPlayBriefResult`
specifically so this adapter can populate them — a real, scoped design change to the brief's own
contract, not a one-line fix, and one the swing play-brief / Largo-contract owner should decide
(wire up vs. trim the dead fields from the type) rather than a drive-by audit pass guessing at
which of the 8 are actually wanted.

### Suggested next step

Whoever owns the swing play-brief / Ask Largo swing-contract thread should decide: (a) wire
`archetype`/`sub_lane`/`entry_premium`/`peak_premium`/`bucket`/`thesis_strength_pct`/`grade`/
`invalidation` up for real by extending `SwingPlayBriefResult` to carry the position row these
values would come from, plus forwarding `largoRead.data` (or the specific fields wanted) through
the route response, or (b) trim the 8 unpopulated fields from `SwingPlayBriefSignal` if they were
aspirational scaffolding that's no longer wanted. No code behavior changes until that decision is
made — not unilaterally touched here.
