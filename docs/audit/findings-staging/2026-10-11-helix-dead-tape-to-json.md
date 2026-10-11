## Helix `helixTapeToJson` — dead export, no JSON-download feature exists — FIXED

> **kind:** `FINDING`

| **Status** | Fixed in PR (fix/helix-dead-tape-to-json) |
|---|---|

**Symptom:** none live — pure dead code found during a routine DISCOVERY-lane sweep, not a
production defect.

**Root cause:** `helixTapeToJson` (`helix-csv-export.ts`) serialized the flow tape to a JSON string
with each row's score context attached. Its sibling `helixTapeToCsv` (same file) is used by
`downloadHelixCsv`, which `FlowFeed.tsx` calls on the member-facing CSV-export button — but no
equivalent `downloadHelixJson` (or any other JSON-download UI) exists anywhere, so
`helixTapeToJson` was never reachable from a real feature.

**Evidence:** `grep -rn "helixTapeToJson\|downloadHelixCsv" --include=*.ts --include=*.tsx src` →
`downloadHelixCsv` has a real caller (`FlowFeed.tsx:275`); `helixTapeToJson` has only its own
definition and direct unit test, before the fix.

**Fix:** Removed `helixTapeToJson` from `helix-csv-export.ts`. Removed its import and direct test
from `helix-csv-export.test.ts` — the remaining `helixTapeToCsv` test, which covers the real
export path, is untouched.

**Fix rationale:** Pure deletion — there is no JSON-download feature to wire it into, and building
one wasn't asked for; this sweep only removes dead code; a JSON-export feature would be a product
decision for the Helix lane.

**Blast radius:** `src/features/helix/lib/helix-csv-export.ts`,
`src/features/helix/lib/helix-csv-export.test.ts` only.

**Regression guard:** `helix-csv-export.test.ts` 1/1 pass (Node 20,
`--experimental-test-module-mocks`). `tsc --noEmit` clean.
