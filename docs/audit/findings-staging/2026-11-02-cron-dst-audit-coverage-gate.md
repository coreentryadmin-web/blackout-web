> **kind:** FINDING

## cron-dst-audit.mjs's COVERAGE (unaudited-jobs) report silently never prints when the registry agrees with the manifest — FIXED

| | |
|---|---|
| **Area** | `scripts/audit/cron-dst-audit.mjs` (text-mode output, the `--json` path was unaffected) |
| **Status** | FIXED — logic extracted to `scripts/audit/lib/cron-dst-coverage-report.mjs`, regression test added, RED→GREEN proven |
| **Severity** | P2 (audit-tooling correctness: a monitoring/coverage report silently stops reporting, not a member-facing defect) |

### Root cause

The script's own header comment (lines ~505-520) documents the COVERAGE section's purpose in
plain terms: it lists every deployed EventBridge cron that is in **neither** the `GATES` nor
`INTENTS` hand-curated tables, so a reader never mistakes "this script said nothing about job X"
for "job X is fine." The comment explicitly says this section is "Loud and visible, not
blocking" — i.e. it must always surface unaudited jobs, independent of anything else the run
found.

The implementation did not match that intent. In the text-mode branch, BOTH the COVERAGE
section and the unrelated "REGISTRY `schedule_cron_utc` vs DEPLOYED MANIFEST" mismatch list were
nested inside a single guard:

```js
if (mismatches.length) {
  console.log(`\nCOVERAGE — ${manifest.size - unaudited.length} of ${manifest.size} deployed jobs are in GATES or INTENTS`);
  if (unaudited.length) {
    console.log(`  ${unaudited.length} deployed job(s) are in NEITHER table. ...`);
    for (const k of unaudited) console.log(`    ${k}`);
    ...
  }
  console.log("\nREGISTRY `schedule_cron_utc` vs DEPLOYED MANIFEST");
  for (const m of mismatches) console.log(...);
}
```

`mismatches` (registry-mirror-vs-deployed-manifest disagreement) and `unaudited` (deployed jobs
missing from `GATES`/`INTENTS`) are two independent, unrelated facts about the fleet. Gating the
entire block on `mismatches.length` means: whenever the registry mirror happens to agree with the
deployed manifest — the ordinary, healthy case — the COVERAGE section (including the "N deployed
job(s) are in NEITHER table" warning) never prints at all, no matter how many real deployed jobs
are unaudited. This is exactly the "absence reads as health" failure shape this very audit exists
to catch elsewhere (a cron that self-skips and returns HTTP 200 looks clean), now present inside
the instrument itself: a clean run with zero registry mismatches but 13 unaudited jobs (the real
count this file's own comment cites from 2026-08-23) prints nothing about those 13 jobs in
text mode — only `--json` mode (which always includes `coverage` in its payload) surfaced it.

### Evidence

Reproduced with a small harness mirroring the exact original gating (see
`scripts/audit/lib/cron-dst-coverage-report.test.mjs`, which was run against both the buggy and
fixed implementation before being wired into the real script):

- `mismatches = []`, `unaudited = ["vector-pick-sweep", "thermal-eod-snapshot"]` → the ORIGINAL
  logic (reproduced inline to prove the bug, then replaced) produces **zero output lines** — the
  "2 deployed job(s) are in NEITHER table" warning and both ticker names are silently dropped.
- The same inputs through the FIXED `buildCoverageReport()` produce the expected COVERAGE header
  and the full unaudited-jobs warning, independent of `mismatches` being empty.
- 4/4 tests in `cron-dst-coverage-report.test.mjs` fail under the reverted (original) gating and
  pass under the fix — confirmed by temporarily restoring the buggy condition, running the suite
  (2/4 failed), then restoring the fix (4/4 passed).

### Blast radius

Confined to this one script's text-mode reporting. `--json` mode (line ~525,
`coverage: { deployed, covered, unaudited }`) was never affected — it always serialized the full
coverage object regardless of `mismatches`. The exit code (`process.exit(broken.length ? 1 : 0)`)
was also unaffected — `unaudited`/coverage was never part of the pass/fail criteria, only a
visibility report, so no CI gate silently passed because of this; the defect is purely that a
human reading the plain-text output of a routine run could not see which deployed jobs the audit
had never classified, which is the opposite of what the surrounding code comments say this
section is for.

### Fix rationale

Extracted the two sections into a pure, independently-testable function
(`buildCoverageReport()` in `scripts/audit/lib/cron-dst-coverage-report.mjs`) where each section
gates on its own condition (`manifestSize > 0` / `unaudited.length` for COVERAGE,
`mismatches.length` for the registry-mismatch list) rather than one borrowing the other's guard.
`cron-dst-audit.mjs` now just prints whatever lines that function returns. Left the `--json`
output and every other section of the script untouched — this is a formatting-independence fix,
not a change to what data is collected or how exit status is computed.
