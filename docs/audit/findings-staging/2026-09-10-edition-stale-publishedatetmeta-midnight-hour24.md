# edition-stale.ts's publishedAtEtMeta had the same ICU midnight-as-"24" quirk as #4703 — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P2-edition-stale-publishedatetmeta-midnight-hour24 |
| **Pri** | P2 |
| **Area** | Night Hawk Legacy/edition — evening-cron rebuild gate |
| **Status** | FIXED |

## Symptom

`shouldRebuildStalePublishedEdition()` (`edition-stale.ts`) must rebuild a `published` edition
row when its `published_at` stamp predates tonight's 17:30 ET edition window — a pre-close or
mistimed resume must not block tonight's post-close playbook (the function's own doc comment).
An edition genuinely stamped `published_at` in the 00:00-00:59 ET window on "today" would be
wrongly judged fresh (inside window, no rebuild needed) instead of stale (needs rebuild).

## Root cause

Identified by the #4703 follow-up sweep (`docs/audit/findings-staging/2026-09-10-icu-midnight-hour24-followup-sweep-10-more-sites.md`,
PR #4714) as "confirmed likely REAL, same shape as #4703." `publishedAtEtMeta()` reads the ET
hour via `Intl.DateTimeFormat({ hour12: false })`, which renders ET midnight as hour `"24"` in
this Node/ICU build, not `"00"` — the exact quirk `session.ts`'s `etNowParts`/
`isBeforeOrAtMarketCloseEt` had (#4703, merged earlier today). Unnormalised, `minutes = Number(get("hour")) * 60 + Number(get("minute"))`
computes `1440-1499` for a `published_at` genuinely in the `00:00-00:59` ET window on "today",
instead of `0-59`.

Unlike this same file's `isInEditionWindow`/`inNighthawkEditionCatchupAlertWindow` (confirmed
latent by the follow-up sweep — their own 17:30-19:30 window comparison never overlaps
`[1440,1499]`, so the buggy value and the correct value are both outside the window and the
wrong answer happens to be harmless), `publishedAtEtMeta` has no time-of-day gate on the
STAMP it parses — only on when `shouldRebuildStalePublishedEdition` itself is *called*
(inside the 17:30-19:30 window). The stamp being evaluated can be any historical
`published_at`, including a genuine 00:xx ET one.

Consequence: `shouldRebuildStalePublishedEdition`'s `meta.date === todayStr && meta.minutes <
windowStart` check — with `windowStart ≈ 1050` (17:30) and the buggy `minutes ≈ 1440-1499` —
reads `false` (looks like it's already inside/after today's window) when the correct `0-59`
value would read `true` (published well before tonight's window, must rebuild).

## Blast radius

Only `publishedAtEtMeta` in this file needed the fix — `isInEditionWindow` and
`inNighthawkEditionCatchupAlertWindow` share the identical unnormalized pattern but are
confirmed latent (traced, not assumed) per the follow-up sweep, so left untouched per this
repo's own "don't fix a call site that doesn't need it" discipline. The other 9 sites the
sweep flagged belong to Swing/SPX/Vector/Largo — out of this lane's scope, left for their
owning lanes.

## Fix

`(Number(get("hour")) % 24) * 60 + Number(get("minute"))` — identical one-line normalisation
pattern `#4703` and this repo's already-correct siblings (`et-session-facts.ts`,
`public-gex-snapshot.ts`) use.

## Evidence

- RED→GREEN, Node 20 (`/opt/node20/bin`): two new tests in `edition-stale.test.ts` —
  `publishedAtEtMeta computes 0-59 minutes for a midnight ET stamp` and
  `shouldRebuildStalePublishedEdition rebuilds a same-day midnight-ET publish` — both failed
  pre-fix (`false !== true`), both pass post-fix. Full file: 11/11 pass.
- Full Night Hawk suite (`node --import tsx --experimental-test-module-mocks --test
  $(find src/features/nighthawk -name "*.test.ts")`): 1358/1358 pass, 0 failures.
- `npx tsc --noEmit -p .`: clean.
