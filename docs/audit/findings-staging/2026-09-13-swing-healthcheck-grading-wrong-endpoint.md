> **kind:** FINDING

## `swing-e2e-healthcheck.mjs`'s own Stage G (GRADING/RECORD) has been reading Night Hawk Legacy's record endpoint, not swing's — every run silently graded the wrong product — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

Live repro, running this lane's own standing baseline tool (`npm run healthcheck:swing`,
2026-09-13): Stage G reported `"68 resolved · WR 66.7% · pending 2 · methodology=v2_fillability"`.
The real swing ledger (`GET /api/market/swing/record`, its own `summary` block) reports `"21
resolved chains · WR 23.8%"` — matching the Swings board's own displayed `"30D WR 23.8%"` exactly.
Two completely different numbers, from two completely different products, both claiming to
describe "swing grading."

Traced to `swing-e2e-healthcheck.mjs`:

```js
// BEFORE
if (wantStage("G")) record = app("/api/market/nighthawk/record");
```

`/api/market/nighthawk/record` is **Night Hawk Legacy's** own outcome endpoint
(`getNighthawkMetrics` → `fetchNighthawkOutcomeAnalytics`, querying `nighthawk_play_outcomes`
joined to `nighthawk_editions` — entry-range, next-day-open/close, morning-verdict: all Legacy
next-day-digest concepts). It has nothing to do with swing's own ledger (`swing_positions`,
served at `/api/market/swing/record`). The route carries no `view`/`horizon` param at all — it is
a single, fixed data source, not a shared multi-desk endpoint this script could scope.

The reason this went unnoticed since the script was built: Legacy's response shape (flat
`total_resolved`/`win_rate_pct`/`segments.current`/`by_conviction`) happens to satisfy every field
the old Stage G code read, so the stage always printed a plausible, real-looking GREEN — genuine
Legacy numbers, silently substituted under a swing-labeled check. This is the exact same bug
*class* already fixed once in this script, for Stage F (MARKS) — see
`swing-healthcheck-mark-eval.mjs`'s own header, `#1191`: a stage reading the wrong shape/source
since it was built, discovered only by comparing its output against the real live product.

### Fix

- The fetch now correctly targets `/api/market/swing/record`.
- `stageG_grading()`'s parsing logic — written entirely against Legacy/0DTE's flat shape — is
  replaced with `evaluateSwingGradingRecord()` (new `scripts/audit/lib/swing-healthcheck-grading-
  eval.mjs`, mirroring the existing `swing-healthcheck-mark-eval.mjs` pattern: pure, unit-tested,
  no live HTTP), which reads swing's real nested `summary` block (`chains`/`resolved_chains`/
  `wins`/`losses`/`breakevens`/`opens`/`win_rate_pct`/`low_n`) and additionally asserts the
  `wins + losses === resolved_chains` invariant `record.ts`'s own docstring establishes (a
  breakeven leg is a documented SUBSET of `losses`, not a third bucket) — so a future accounting
  drift in that invariant is caught here too, not just assumed.
- A response missing the `summary` block (the exact shape the old Legacy-endpoint bug produced)
  now reads as an honest AMBER `"no summary block"` rather than silently producing plausible
  numbers for the wrong product — this is the regression the new tests pin directly.

### Blast radius

Single stage in a single audit script (`scripts/audit/swing-e2e-healthcheck.mjs`), plus the two
new files. Nothing in application/member-facing code changed — the win-rate figure members
actually see (Swings board `"30D WR"`, `/api/market/swing/record`'s own `summary.win_rate_pct`)
was never wrong; only this lane's own health-check tooling was silently validating a different
product's data.

### Fix rationale

Extracted the verdict logic to a pure, unit-tested module rather than patching the URL alone and
leaving the parsing inline — the URL fix alone would have made Stage G silently AMBER (reading
`record.total_resolved` etc. against swing's actual nested shape, all `undefined`) instead of
silently wrong, which is a different failure mode but still not a real fix. Matched the existing,
already-accepted convention in this exact file (Stage F's own `swing-healthcheck-mark-eval.mjs`)
rather than inventing a new pattern.

### Evidence of testing

- Live repro: `npm run healthcheck:swing -- --stage=G` before the fix printed the Legacy numbers
  (68/66.7%); the real swing summary (21/23.8%) was pulled directly from
  `GET /api/market/swing/record` for comparison, and matches the Swings board's own displayed WR.
- New tests, 7 total, in `swing-healthcheck-grading-eval.test.mjs`: the real live swing shape
  (GREEN, correct numbers); the exact Legacy-endpoint regression shape (must read AMBER "no
  summary block", never silently produce a plausible-looking check off the wrong product); no
  record; `available:false`; zero resolved chains; a synthetic wins+losses accounting mismatch;
  low_n flagged AMBER.
- RED confirmed: removing the new source file broke the test file's own module load (import
  failure), the exact regression signature.
- GREEN: fix restored, 7/7 pass.
- Live re-run of `npm run healthcheck:swing -- --stage=G` against production AFTER the fix: now
  correctly reports `"21 resolved chain(s) of 21 · WR 23.8% · wins=5 losses=16 breakevens=5
  opens=0"` — 🟢 GREEN.
- Full `scripts/audit/lib/*.test.mjs`: 580/580 pass.
- `npx tsc --noEmit`: clean.

Found during the Night Hawk Swings standing aggressive-mode improvement-hunt mandate — a periodic
run of this lane's own baseline tool (`npm run healthcheck:swing`), explicitly named in the
standing mission text ("Baseline: use judgment on frequency"), surfaced a win-rate figure that
directly contradicted every other live source this session had already independently verified
(the board's own 30D WR, and `/api/market/swing/record`'s own summary) — worth chasing rather than
dismissing as noise. Audit-tooling-only, no product/member-facing impact — no cross-desk sign-off
needed under the standing CARVE-OUT discipline.
