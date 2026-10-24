## Night Hawk Legacy BACKFILL/gate-promoted plays could recommend an already-expired, unquotable option contract — `pickAffordableChainContract` had no expiry floor against the edition's own target trading day

> **kind:** `FINDING`

| **Status** | FIXED |
|------------|-------|

**Symptom:** standing Ask Largo × Night Hawk Swings ownership mandate (extends to the whole Night
Hawk product — 0DTE, Swings, Legacy). `GET /api/market/nighthawk/edition` on 2026-10-24 returned
an edition with `edition_for: "2026-10-26"`, `published_at: "2026-10-23T21:40:16.000Z"`, carrying a
BACKFILL/`gate_promoted` PLTR play that recommended **"PLTR $197.5 Call 2026-10-23"** — an expiry
3 calendar days *before* the edition's own target trading day, already expired by the time the
edition was even published. Confirmed dead: `GET /api/market/nighthawk/legacy-marks?occs=PLTR261023C00197500`
returned `{mark:null, bid:null, ask:null, asof:null}` — completely unquotable — while the organic-
path plays in the same edition (CRWD, NET) carried real Friday-close quotes. A member reading this
edition would have been shown an actionable-looking options play with no live market behind it at
all.

**Root cause:** `pickAffordableChainContract` (`src/features/nighthawk/lib/play-backfill.ts`), the
contract picker used exclusively by the BACKFILL/gate-promoted path (`selectBackfillPlays` →
`backfillThinEditionPlays`), filtered chain rows only on ask-affordability (`MAX_OPTION_PREMIUM_PER_SHARE`)
and open interest (`tieredMinOi`), then ranked survivors by `|strike - spot|` and, as a tiebreak,
ascending expiry string — with **zero comparison of `row.expiry` against the edition's target
trading day or "today" anywhere in the function.** Its sibling on the organic path, `pickChainContract`
(`src/features/nighthawk/lib/deterministic-edition.ts`), already takes an `asOfEtYmd` parameter
(every one of its 4 call sites passes `params.edition_for`) and hard-excludes `row.expiry <= today`
before a row is even scored (comment: *"Swing never trades a same-day expiry"*) — the exact guard
`pickAffordableChainContract` was missing. The only upstream protection,
`resolveTickerChainRows`'s Polygon snapshot (documented as "non-expired expiries"), is not an
absolute guarantee — a chain fetched right at/after a Friday close can still momentarily carry that
day's own, about-to-expire contract, which is consistent with this edition's `published_at`
(21:40 UTC, i.e. 5:40pm ET Friday) landing right after that day's 2026-10-23 contracts expired.
Once such a row survives into the candidate pool, nothing stopped it from winning on
strike-distance/cost if it happened to be the nearest or cheapest — which is exactly what happened
here (an at-the-money, near-zero-premium expired contract beating a genuinely live one on both
axes `pickAffordableChainContract` actually checks).

**Fix:** added the same hard expiry floor `pickChainContract` already enforces. `pickAffordableChainContract`
now takes an optional `asOfEtYmd` parameter (default `todayEtYmd()`) and excludes any row with
`row.expiry <= today` inside its existing `affordable()` filter, before ranking — same hard,
unconditional exclusion `pickChainContract` applies, deliberately *not* its full 2-10 DTE
floor/ceiling band (that band has soft fallback pools — `shortDated`/`longDated` — for when
nothing in the ideal window qualifies; "already expired" has no such fallback in either picker, so
it is the one exclusion both pickers share and the only one this fix adds). The date is threaded
through the whole call chain: `selectBackfillPlays` gained `asOfEtYmd`, `backfillThinEditionPlays`
gained `editionFor` (passed straight through as `asOfEtYmd`), and all 4 real call sites —
`post-publish-backfill.ts`'s `republishBackfilledEdition` (already has `editionFor` as its own
parameter) and the 3 call sites inside `edition-builder.ts`'s `buildEveningEdition` (all already
have `editionFor` in scope from line 651) — now pass it. Omitting `editionFor`/`asOfEtYmd` falls
back to today's ET date rather than erroring, since "today" is still a strictly correct (if less
precise than the edition's own target day) floor.

**Blast radius:** every Legacy edition's BACKFILL/gate-promoted-tier play was exposed whenever the
best-matching chain row for a candidate happened to carry a trailing/about-to-expire contract — not
just this one PLTR instance. All 4 production call sites of `backfillThinEditionPlays` now pass the
edition's target day, so every path (the live evening-edition build's 3 backfill branches, and the
admin `republishBackfilledEdition` repair endpoint) is covered, not just one.

**Fix rationale — what was deliberately left unchanged:** only `pickAffordableChainContract`'s
missing guard was touched; `pickChainContract` itself (the organic path, already correct) was not
modified. The full 2-10 DTE band was deliberately not imported into the backfill picker — that
soft-fallback machinery solves a different problem (picking a *best-available* contract when
nothing in the ideal window qualifies) that backfill's existing "skip rather than placeholder"
discipline (`selectBackfillPlays` already `continue`s and warns when `pickAffordableChainContract`
returns `null`) already handles correctly for the harder "nothing live exists" case; adding it would
have been unrelated scope creep on top of the actual defect (a missing *hard* exclusion, not a
missing *soft* preference).

**Verify:**
- `src/features/nighthawk/lib/play-backfill.test.ts` — 4 new/changed cases: (1) a PLTR-shaped
  regression fixture reproducing the exact live defect (an already-expired, nearest-strike,
  cheapest-ask row vs. a genuinely live one) now correctly picks the live contract and never the
  expired one; (2) a contract expiring exactly ON the edition's target day is excluded too, not
  just a past one; (3) omitting `asOfEtYmd` still floors against today's real ET date. The 3
  pre-existing `pickAffordableChainContract` fixture tests used a hardcoded past calendar date
  (`"2026-07-17"`) that would otherwise have gone stale and silently broken under the new floor —
  switched to a `todayEtYmd()`-relative future date (reusing the file's own pre-existing `ymdPlus`
  helper, hoisted to the top of the file and de-duplicated) so these fixtures can never rot the
  same way again.
- Confirmed RED pre-fix (source reverted to the pre-fix `origin/main` version via `cp`/`git show`,
  the 3 new tests failed exactly as expected while all 22 pre-existing tests still passed — proving
  the fixture-date fix alone didn't mask the regression), GREEN post-fix: 25/25 in
  `play-backfill.test.ts`, 126/126 across `play-backfill.test.ts` +
  `play-backfill-merit.test.ts` + `deterministic-edition.test.ts` + `post-publish-backfill.test.ts`
  together, on Node 20.
- `npx tsc --noEmit` clean on Node 20.
