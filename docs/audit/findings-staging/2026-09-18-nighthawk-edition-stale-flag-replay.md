> **kind:** `FINDING`

## Night Hawk Legacy edition showed a false "not published yet" banner over a correct, current edition — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Legacy (`src/app/api/market/nighthawk/edition/route.ts`) — found via the Ask Largo standing mandate's 5-engine health-check deep-dive |
| **Severity** | P2 (real, member-facing false-staleness banner over correct, current content) |
| **PR** | fix/nighthawk-edition-stale-flag-replay |

### Root cause

`stale`'s only assignment site anywhere in the edition pipeline is `resolveNighthawkEdition`'s own
`edition.edition_for !== editionFor` check (`resolve-edition.ts:203`) — so by that flag's own
definition it means EXACTLY "this is a carried-forward, date-mismatched edition," nothing else.

`timeoutFallbackEdition` (the `maxBlockMs` fallback used when a live resolve blows past its
deadline) already restamps `stale`/`served_for` at SERVE time for the case where
`lastGoodEdition.edition_for !== editionFor` — the doc comment right above it explains why:
"trusting whatever flag was baked in at CAPTURE time is not enough." But that same reasoning was
never applied to the OTHER branch: when `lastGoodEdition.edition_for === editionFor`, the function
returned `lastGoodEdition` completely unmodified — including a `stale:true` that may have been baked
in at an EARLIER capture, when the date being requested THEN genuinely didn't match. Once the
currently-requested `editionFor` naturally catches up to match `lastGoodEdition.edition_for`, the
dates DO match now, so `stale` must be `false` by the flag's own definition — but the stale
capture-time flag was replayed unchanged.

Live repro (real production data, authenticated Clerk session, reproduced 3x consecutively):
`GET /api/market/nighthawk/edition` returned `stale:true` with `edition_for === served_for ===
"2026-09-18"` (the requested date) and `published_at` confirming a real, on-time edition with 4
real plays. `containers.tsx:461-474` renders this as "Showing 2026-09-18 edition — tonight's not
published yet" over content that was, in fact, already published and current.

### Evidence

- Live repro as described above, reproduced 3 consecutive requests.
- `resolve-edition.ts:203` confirmed as the sole `stale = true` assignment site (grep-verified).
- RED→GREEN independently reproduced via `git stash` (fix isolated to
  `src/app/api/market/nighthawk/edition/route.ts`): 11/12 fail pre-fix (the new test), 12/12 pass
  post-fix.
- `src/app/api/market/nighthawk/edition/route.test.ts` full file: 12/12 pass.
- Full nighthawk suite (`src/features/nighthawk` + `src/app/api/market/nighthawk`, 158 test files):
  1791/1791 pass.
- `npx tsc --noEmit -p .` on Node 20: clean.

### Blast radius

Single function (`timeoutFallbackEdition`), only reached on the `maxBlockMs` timeout fallback path
(both the fire-and-forget peek-hit refresh and the blocking cold-miss path use the same fallback).
`resolveNighthawkEdition`'s own normal (non-timeout) resolve path was never affected — its single
`stale` assignment site already behaves correctly. No change to when an edition IS genuinely stale
(a real date mismatch) — only to the case where a previously-captured stale snapshot's flag needs
re-evaluating once the requested date catches up to it.

### Fix rationale

Added an explicit branch: when `lastGoodEdition.edition_for === editionFor` (the existing
"same-date, serve as-is" case) AND `lastGoodEdition.stale` is true, return a copy with `stale:false`
and `served_for:undefined` rather than the captured object unmodified — matching the exact same
"capture-time flags are not enough, only serve-time truth is" principle the function's own doc
comment already states for the mismatched-date branch immediately above it. Left the common,
non-stale case (`return lastGoodEdition;` unmodified) untouched to avoid an unnecessary object copy
on the hot path.

### Verification

Independently re-verified from scratch on a fresh branch off actual latest `origin/main` — RED/GREEN
independently reproduced via `git stash`; the full nighthawk test suite and `tsc --noEmit` both
clean.
