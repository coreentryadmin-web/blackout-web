## 2026-09-12 — [FINDING, P4 dead-code, WS-22 flow-amendment reconciliation] `flow-amendment.ts` has zero production callers and its target scenario doesn't occur in UW's real API — built defensively, never validated, never wired

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | REPORTED, NOT FIXED — write-up only, per this cycle's own scope discipline (a deliberately-named work stream, "WS-22," deserves the owning lane's judgment on removal, not a unilateral delete). |
| **Severity** | P4 — no live risk either way: since nothing calls it, its absence changes nothing; its presence is pure unused surface area, not a security or correctness issue. |

### What was found

Swept `src/lib/*.ts` (top level, outside the 9 active lanes' own subdirectories) for modules with
zero non-test importers, as a dead-code check. `src/lib/flow-amendment.ts` (~170 lines, own header:
*"WS-22 — amended / corrected UW print reconciliation"*) is imported ONLY by its own test file
(`flow-amendment.test.ts`) — `grep -rln 'from ["\'].*flow-amendment["\']' src` outside test files
returns nothing.

### Why this isn't just "another unwired feature" — the scenario it defends against doesn't appear to exist

The module's purpose: UW can (per its header comment) re-send a print for the same underlying
event with revised fields, and naive handling would double-count it. `detectAmendmentFromRaw(raw)`
looks for any of 13 plausible field-name variants UW might use to signal this
(`event_key`/`event_id`/`original_alert_id`, `amends_alert_id`/`amends_id`/`supersedes_id`/
`corrects_id`, `version`/`revision`/`amendment_seq`, `amended`/`corrected`/`is_amendment`).

Checked three independent sources, all in agreement:
1. **The live UW flow-alerts API itself** — `GET https://api.unusualwhales.com/api/option-trades/flow-alerts?limit=200`
   (real request, real key): 200 real rows, 35 unique field names across all of them, **zero
   overlap** with any of the 13 amendment-related names above.
2. **`src/lib/providers/flow-ingest.ts`** (the real, live ingestion path) — never reads or stores
   any of these fields from the raw response; there is no capture point upstream of
   `flow-amendment.ts` even if UW did send one.
3. **`src/lib/uw-docs-catalog.ts`** (the auto-generated catalog of UW's ENTIRE documented REST API
   surface, generated from `https://api.unusualwhales.com/docs`, 1932 lines) — zero mentions of
   "amend," "correct," or "revis[e/ion]" anywhere, across every endpoint UW publishes.

So this isn't the familiar "the fix exists, just needs wiring into the live pipeline" shape seen
elsewhere this session (BIE router, roll-history disclosure, etc.) — wiring it in would have
nothing real to read. The module appears to have been built defensively/proactively (multiple
plausible field-name guesses, never narrowed to one confirmed real field) rather than against an
observed live payload.

### Why write up, not delete

`flow-amendment.ts` traces to a named work stream ("WS-22"), which suggests deliberate planning —
possibly informed by something outside this repo's visibility (a UW support conversation, a
changelog note, or a planned-but-unshipped UW feature). Absence of evidence in the current public
API is not proof the concern was invalid when the module was written, only that it doesn't apply
TODAY. Deleting someone else's deliberately-named defensive infrastructure on this session's own
evidence, without the original author's context on why WS-22 exists, is a bigger call than this
session's standing scope discipline is comfortable making unilaterally — flagged for whoever owns
the UW-integration surface to decide: keep as forward-looking (harmless, ~170 lines) or remove
(the honest current-state read is that it's unnecessary).

### Evidence

- `grep -rln 'from ["\x27].*flow-amendment["\x27]' src --include=*.ts --include=*.tsx` (excluding
  the file's own test): no results.
- Live UW API sample (200 rows, `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY curl
  https://api.unusualwhales.com/api/option-trades/flow-alerts?limit=200`): 35 unique keys, none
  matching any of `detectAmendmentFromRaw`'s 13 recognized field names.
- `grep -i "amend\|correct\|revis" src/lib/uw-docs-catalog.ts`: zero matches across the full
  auto-generated UW endpoint catalog.
