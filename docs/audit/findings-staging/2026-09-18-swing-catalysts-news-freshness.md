## Ask Largo swing brief's "Catalysts & news" headlines carried no freshness disclosure, unlike every sibling freshness-aware section

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Ask Largo swing play-brief — `catalystsSection` (`src/lib/swing/play-brief-intel.ts`), the ecosystem-arsenal news reader (`src/lib/bie/ecosystem-context.ts`) |
| **Severity** | P3 (member-facing narrative quality / Largo product-contract C2 — freshness) |
| **Status** | FIXED — `fix/swing-catalysts-news-freshness` |

### Root cause

`NewsResult.asOf` (`src/lib/providers/polygon-news.ts`) is stamped once, at true fetch time, inside
`serverCache`'s cached builder. Under that cache's stale-while-revalidate path, a degraded Benzinga
upstream can keep serving the same stored headline list — and its un-bumped `asOf` — for up to
`MAX_STALE_AGE_MS` (10 minutes, `server-cache.ts`). This is the identical exposure
`meridianCatalystStale`/`meridianCatalystSection` already document and guard for the sibling
Meridian catalyst read.

That field was computed correctly upstream but silently dropped one layer up, in
`assembleEcosystemArsenal` (`ecosystem-context.ts`) when folding the raw `NewsResult` into
`EcosystemArsenalNews` — the type carried only `count`/`newest`/`headlines`, never `asOf`. So
`catalystsSection`, the sole consumer of `arsenal.news.headlines`, had no way to ever disclose
staleness — unlike every other freshness-aware section in the same file (GEX, Vector, Meridian).

### Evidence

Read `ecosystem-context.ts`'s `EcosystemArsenalNews` type and `assembleEcosystemArsenal`'s news
branch directly: `headlines: reads.news.items.slice(0, 4).map(...)` was present, `as_of` was not,
even though `reads.news` (`NewsResult`) carries a real `asOf: string` field
(`polygon-news.ts:60`, populated at `polygon-news.ts:107`). Cross-checked `play-brief-intel.ts`'s
`catalystsSection`: it read `arsenal.news.headlines` with zero staleness check, while the adjacent
`meridianCatalystSection` (same file) already reads `ctx.meridian`'s freshness via
`meridianCatalystStale`/`meridianCatalystAgeMs` and prepends a "Last snapshot" disclosure line.

### Blast radius

Single call site (`catalystsSection`'s "Headlines" block) and its one upstream data path
(`assembleEcosystemArsenal`'s news branch). `EcosystemArsenalNews.as_of` is additive/optional, so
no other consumer of that type is affected.

### Fix rationale

Mirrored the existing, already-shipped `meridianCatalystStale`/`meridianCatalystAgeMs` pattern
exactly, at the same `GEX_MATRIX_STALE_MS` (120s) threshold used by every other freshness check in
`play-brief-absence.ts`, rather than inventing a new convention:
- `ecosystem-context.ts` — added `as_of?: string | null` to `EcosystemArsenalNews`, populated from
  `reads.news.asOf ?? null` in `assembleEcosystemArsenal`.
- `play-brief-absence.ts` — added `newsCatalystAgeMs`/`newsCatalystStale`, structurally identical to
  `meridianCatalystAgeMs`/`meridianCatalystStale`.
- `play-brief-intel.ts` — `catalystsSection` now prepends a
  `**Last snapshot** (~Xs old) — headlines may lag.` line when stale, using the same
  `ageSecondsLabel` helper the Meridian section already uses.

`as_of` is optional so an older/hand-built fixture without the field degrades to "unknown, not
stale" rather than a false positive — `newsCatalystStale` treats a missing timestamp the same way
`meridianCatalystStale` treats a missing slice.

### Verification

- Independent RED→GREEN (reverted only the 3 source files, kept the tests):
  `npx tsx --experimental-test-module-mocks --test src/lib/bie/ecosystem-context.test.ts
  src/lib/swing/play-brief-absence.test.ts src/lib/swing/play-brief-intel.test.ts` — 6/243 failed
  with the source reverted, exactly the new assertions. Reapplied — 243/243 pass.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/*.test.ts src/lib/bie/*.test.ts` —
  1995/1995 pass.
- `npx tsc --noEmit` — clean.
- Full `npm test` (Node 20) — 14620/14623 pass, 0 fail, 3 pre-existing skips.
