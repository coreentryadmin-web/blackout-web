> **kind:** FINDING

## Night Hawk Legacy — recap-only edition falsely marked `stale`, live false banner — FIXED

| **Status** | Fixed (PR TBD) |
|---|---|

**Found:** 2026-10-20, 5-engine live monitor cycle (Ask Largo standing mandate), live-audited by a
background workflow agent checking `GET /api/market/nighthawk/edition`.

**Root cause:** `resolveNighthawkEdition` (`src/features/nighthawk/lib/resolve-edition.ts`) has a
carry-forward branch meant to catch "today's own edition, still before its own market close" and
mark it `carry_until_close` (never `stale`). That branch reads
`fetchLatestPlayableNighthawkEdition()` (`src/lib/db.ts`, `WHERE jsonb_array_length(plays) > 0`),
so a **recap-only (zero-play) edition published for today never qualifies there** and falls
through to the generic "latest edition" branch, which stamps `stale: true` purely from a date
comparison against the requested `editionFor` — and `editionFor` for the live default (no `?date=`)
path is always `nextTradingDayEt(todayEt())`, i.e. tomorrow's trading day, so that comparison is
true on literally every calendar day the branch is reached. On a normal (has-plays) day the
carry-forward branch catches it first; on a recap-only day nothing does.

**Live impact:** confirmed reproducing on 4 consecutive session days (Oct 17-20, 2026). The default
`GET /api/market/nighthawk/edition` fetch — exactly what the production `LegacyDeck` board calls —
returned `edition_for: '2026-10-20'`, `published_at` ~14h earlier (same day, on time), `recap_only:
true`, `no_plays: true`, but `stale: true`. Two member-facing surfaces both check `isStale` before
their own recap-only case (`containers.tsx`'s `bannerText` ternary and `PlaybookBoard.tsx`'s
`resolveEditionStatus`), so both rendered a false "tonight's not published yet" / "Prior edition"
state over a correctly-published, current, honest recap-only edition.

**Evidence:** live payload capture (`GET /api/market/nighthawk/edition`, no date param, 2026-10-20
~07:40 ET) vs. `GET .../edition?date=2026-10-19` (an exact-date recap-only lookup, which correctly
comes back with `stale` unset) — proving the bug is isolated to the default/no-date path.
Independently corroborated by `scripts/audit/legacy-e2e-healthcheck.mjs --json`: stage `A_edition`
verdict AMBER with matching evidence text.

**Fix:** scope the `stale` stamp in the generic "latest edition" branch to exclude a `recap_only`
edition that is still within its own trading day (`isBeforeOrAtMarketCloseEt(edition.edition_for)`)
— mirrors the exact condition the carry-forward branch already uses, without needing to touch that
branch or `fetchLatestPlayableNighthawkEdition()` itself (that function's play-count filter is
correct and still needed by its other two callers, `mobile/signals` and `gex-heatmap`, which
genuinely need "last edition with real tickers to act on"). A recap-only edition doesn't need
`carry_until_close` either — there are no plays to carry forward, and the existing `recap_only`
flag already drives the correct, honest banner on both surfaces once `stale` stops being wrongly
set.

**Blast radius:** both `src/features/nighthawk/command-deck/containers.tsx` (bannerText) and
`src/features/nighthawk/components/PlaybookBoard.tsx` (resolveEditionStatus) read `edition.stale`
and are both fixed by this one server-side change — same root cause, two UI surfaces, fixed once at
the shared source of truth.

**Test:** `src/features/nighthawk/lib/resolve-edition.test.ts` (new file) — RED→GREEN proven via
`git stash` on the production file alone: the live-repro case fails without the fix (recap-only,
same-day edition wrongly marked stale) and passes with it; three adjacent cases (an old recap-only
edition past its own close, a non-recap edition past its own close, and an explicit `?date=` exact
lookup) are asserted unchanged to prove no regression. `resolve-edition.ts`'s own import of the
heavy `edition-builder.ts` (which transitively carries `import "server-only"` and cannot load under
the plain Node test runner) required mocking that one module with a faithful, documented stand-in
for its single pure export (`rowToNightHawkEdition`) rather than spreading the real module — no
prior test exercised `resolve-edition.ts` at all before this change.
