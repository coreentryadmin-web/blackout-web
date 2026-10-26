## Ask Largo / Night Hawk Swings: `worstKnownSwingDataAgeMs` silently drops the `optionMarkGenuinelyUnknown` case, so a freshly-committed position with a never-synced mark reports Largo-contract `freshness:"live"`

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED (PR #TBD) |
| **Found by** | Ask Largo × Night Hawk Swings standing ownership mandate — live audit cycle against `GET /api/market/swing/play-brief` (authenticated prod session), 2026-10-26, 3 fresh tickers (PONY/SKHY/CLF) |
| **Scope** | `src/lib/swing/play-brief-intel.ts` (`worstKnownSwingDataAgeMs`), `src/lib/swing/play-brief-absence.ts` (`SWING_OPTION_MARK_STALE_MS` exported for reuse) |

### Root cause

`worstKnownSwingDataAgeMs` (play-brief-intel.ts, ~line 3447) feeds the Largo-contract top-level
`freshness`/`age_seconds` fields (`adaptSwingBriefToLargo`, play-brief-adapter.ts) — the fix for the
2026-10-21 FINDING that replaced those fields' prior hardcoded `null`/`"cached"` constants with a
real computed "worst known per-source age."

That replacement computation itself has a residual gap: its option-mark branch only contributed an
age when `playExpectsLiveOptionMark(play.status) && play.markIsSync !== true && play.markAsOf` all
held — the ordinary "aged timestamp" shape. It silently excluded every `play.markIsSync === true`
case, including the specific sub-case this same file already has a named helper for,
`optionMarkGenuinelyUnknown` (play-brief-absence.ts): `markIsSync===true && playExpectsLiveOptionMark
(status) && pnlPct==null` — a committed position whose option mark has **literally never synced a
live quote** (`mid = last_mark ?? entry_premium`, the true entry-fallback case).

When that genuinely-unknown mark is the only stale/unknown source on a brief and Vector/GEX happen
to be fresh this cycle — routine for a position freshly committed by `banger-discovery`/
`swing-discovery`, before its first `swing-active-refresh` tick ever runs — the function fell
through to just the fresh Vector/GEX ages. The Largo-contract `freshness`/`age_seconds` fields then
reported "live, N seconds old" while the SAME response's own Position section said "Mark:
**unknown** _(sync quote, no live price yet — do not read as flat)_" and `unavailableSources`
carried `{source:"option mark", reason:"no live price yet — sync quote, no real quote value has
ever landed"}` — the exact narrative-vs-structured mismatch the 2026-10-21 fix was built to
prevent, slipped through at the one sub-case it didn't thread the existing absence signal into.

### Evidence

Live `GET /api/market/swing/play-brief?playId=SWING:CLF:2116&ticker=CLF&positionId=2116&status=OPEN&expandIntel=1`
(prod, authenticated temp Clerk session, 2026-10-26): top-level response carried
`"dataAgeMs":2453,"freshness":"live","age_seconds":2`. In the SAME response: `envelope.sections`
'Position' says `Mark: **unknown** _(sync quote, no live price yet — do not read as flat)_`; `P&L:
**—** _(entry-time read — no live tick since commit, do not read as current)_`;
`envelope.unavailableSources` lists `{source:"option mark", reason:"no live price yet — sync quote,
no real quote value has ever landed"}`; `confidence` is downgraded to "moderate — 5 sources
unavailable this cycle (HELIX flow, option mark, Vector dark pool, Night Hawk Legacy, thesis
health)". So the structured C2 field said "live, 2 seconds old" while the body of the exact same
answer said the core field it would be fresh *about* has never had a value.

Reproduced locally with a regression test (`src/lib/swing/play-brief-adapter.test.ts`): a fixture
with `markIsSync:true`, `status:"OPEN"`, `pnlPct:null`, and a deliberately FRESH Vector snapshot
(`dataAgeMs:5000`, well under the 120s "live" cutoff) reproduced `freshness:"live"`,
`age_seconds:5` pre-fix — confirmed RED via `git stash` (fix stashed, test kept) before applying the
fix, then GREEN after.

### Fix

In `worstKnownSwingDataAgeMs`, split the option-mark branch: when `optionMarkGenuinelyUnknown(play)`
holds, push `SWING_OPTION_MARK_STALE_MS` (the option mark's own existing "too stale to trust" bound,
newly exported from play-brief-absence.ts for this reuse) into the `ages` array as a sentinel,
rather than silently contributing nothing. There is no real elapsed duration to report here (unlike
an aged `markAsOf`, where `readMs - markMs` is a genuine measurement) — reusing the existing bound
guarantees `freshnessFromAgeSeconds` (play-brief-adapter.ts) buckets the answer "stale" (the bound
sits exactly at that function's own stale cutoff, 1080s) without fabricating a number that looks
more precise than it is. This mirrors how `optionMarkGenuinelyUnknown` is already treated as the
worst case everywhere else this file reads it (`collectOptionMarkStalenessAbsence`, the confidence
tier, the Data-freshness prose) — the fix brings the Largo-contract age computation into agreement
with every other consumer of this same signal, rather than inventing a second, independent notion of
"how bad is this."

Deliberately NOT used: `Number.POSITIVE_INFINITY` as the sentinel (a precedent that exists elsewhere
in this codebase for an unrelated "future clock skew" case, `vec.dataAgeMs`) — that value is
explicitly documented elsewhere in this file as something callers must guard against leaking into
display strings ("Vector data **Infinitys** old"), and would silently degrade to `age_seconds:null`
on JSON serialization (`JSON.stringify(Infinity) → null`), decoupling the wire value from the
in-memory one for no benefit over a concrete, already-meaningful constant.

### Regression test

`src/lib/swing/play-brief-adapter.test.ts`: *"adaptSwingBriefToLargo: a genuinely-unknown option
mark (never synced a live quote) must not read freshness:'live' even when Vector/GEX are fresh this
cycle (Largo C2)"* — fixture has `markIsSync:true`/`pnlPct:null`/`status:"OPEN"` plus a fresh Vector
snapshot; asserts the brief's own Position prose actually says "Mark: **unknown**" (sanity that the
genuinely-unknown condition is really in play), then asserts `largoRead.freshness === "stale"` (not
"live").

### Verification

- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-adapter.test.ts` — RED
  pre-fix (8 pass / 1 fail, `git stash` of the two source files with the test kept in place), GREEN
  post-fix (9 pass / 0 fail).
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-absence.test.ts src/lib/swing/play-brief-intel.test.ts src/lib/swing/play-brief.test.ts`
  — 629 pass / 0 fail (full suite covering these three files, Node 20).
- `npx tsc --noEmit` — clean, exit 0 (Node 20).
