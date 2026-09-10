# Build a dedicated Night Hawk Legacy end-to-end healthcheck — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-P3-legacy-e2e-healthcheck-tool |
| **Pri** | P3 (tooling) |
| **Area** | Night Hawk Legacy audit toolkit |
| **Status** | FIXED |

## Symptom

The standing Night Hawk Legacy audit brief has carried an explicit "HONEST STARTING POINT"
note for its whole lifetime: no dedicated `legacy-e2e-healthcheck.mjs` exists (unlike 0DTE's
`zerodte-e2e-healthcheck.mjs` and Swing's `swing-e2e-healthcheck.mjs`), and "if you're
repeating manual checks every cycle, build one." Across roughly a dozen ~15-minute cycles this
session, the exact same three checks (edition freshness/staleness, mark sanity, record
internal consistency) were re-derived by hand every time via ad-hoc `node --import tsx -e`
one-liners — the trigger condition the brief itself names.

## Fix

Built `scripts/audit/legacy-e2e-healthcheck.mjs` (`npm run healthcheck:legacy`), mirroring the
shape of the 0DTE/Swing siblings: three stages (EDITION / MARKS / RECORD), each GREEN/AMBER/RED
with one-line evidence, worst-of rollup, non-zero exit on any RED. Pure judging logic lives in
`scripts/audit/lib/legacy-healthcheck-eval.mjs`, unit-tested separately from the live runner —
this caught a real bug before it ever ran against production: the initial `rollupVerdict`
ranked `SKIPPED` as worse than `GREEN` (contradicting its own doc comment that "SKIPPED never
counts as a failure"), which a RED→GREEN test on the pure helper caught immediately, before the
runner script that calls it was ever exercised live. Fixed to exclude SKIPPED stages from the
rollup entirely (all-SKIPPED rolls up to SKIPPED, not a fabricated GREEN).

Stage semantics deliberately match this repo's own absence-honesty conventions elsewhere: a
fetch failure is RED (never silently read as "nothing to show," per the standing auth-failure
rule already in the Legacy brief), a genuinely-empty-but-honestly-flagged edition (`no_plays:
true`) is GREEN not a defect, and a missing/null mark (no live quote yet) is AMBER not RED.

## Evidence

- Live run against production (`npm run healthcheck:legacy`), same-session state already
  manually verified all cycle: `A EDITION GREEN`, `B MARKS GREEN` (all 3 open OCCs within
  `[bid, ask]`), `C RECORD GREEN` (14d window, buckets sum to `resolved`). Matches every manual
  check already logged in `docs/audit/nighthawk-legacy-live-journal.json` this session.
- `--json` output validated as well-formed JSON.
- RED→GREEN on the eval helpers: `rollupVerdict(["GREEN", "SKIPPED"])` asserted `GREEN`, got
  `SKIPPED` pre-fix; 27/27 pass post-fix (`scripts/audit/lib/legacy-healthcheck-eval.test.mjs`).
- Full Night Hawk suite + the new eval tests: 1385/1385 pass
  (`node --import tsx --experimental-test-module-mocks --test $(find src/features/nighthawk
  -name "*.test.ts") scripts/audit/lib/legacy-healthcheck-eval.test.mjs`).
- `npx tsc --noEmit -p .`: clean. `npx eslint` on the three new files: clean.
