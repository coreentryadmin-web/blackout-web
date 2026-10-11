## Stale "grid-warm" wording in `admin-zerodte-health.ts`'s module header, five sessions after the cron itself was renamed to `zerodte-warm` — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Status** | FIXED |
| **Severity** | P4 (doc-accuracy only — the executable code is correct, confirmed before and after) |
| **Component** | `src/lib/admin-zerodte-health.ts` — module header comment + one field doc comment |

### Symptom

The module's own header comment (lines 31-46) and `ZeroDteHealthScanSummary.scan`'s field doc (line 77) described the scan-staleness source as the `"grid-warm"` cron, including citing a specific file path: `src/app/api/cron/grid-warm/route.ts`. That route directory does not exist (`ls src/app/api/cron/grid-warm/` → "No such file or directory") — the real route is `src/app/api/cron/zerodte-warm/`. The executable code itself was already correct: a separate, correctly-dated comment at line 119-121 and the actual lookup at line 122 (`cronHealth.jobs.find((j) => j.key === "zerodte-warm")`) both use the right, renamed key.

### Root cause

The cron was renamed from `"grid-warm"` to `"zerodte-warm"` on 2026-07-07 when classic Grid was deleted (per `cron-registry.ts` and the file's own in-code comment at the actual lookup site). Whoever wrote that inline comment and updated the lookup key never went back to the module-level header written before the rename — so the file now carries two inconsistent accounts of its own cron name: the executable line is current, the prose above it is 3+ months stale and points at a route path that no longer exists.

### Evidence

`ls src/app/api/cron/` confirms the live route list includes `zerodte-warm/` and no `grid-warm/`. `tsc --noEmit` clean before and after (comment-only change). `src/lib/admin-zerodte-health.test.ts`: 12/12 pass, unaffected (no test asserted on comment text).

### Fix

Updated the module header and the one field doc comment to say `"zerodte-warm"` throughout and cite the real route path (`src/app/api/cron/zerodte-warm/route.ts`), folding in the rename context the inline comment at the lookup site already carried rather than duplicating it with different wording.

### Fix rationale

Doc-only correction — matched the already-correct executable code and its own nearby comment rather than inventing new wording. Left the local variable name `gridWarm` (lines 123-130) untouched: it's a private binding, not user- or log-facing, and renaming it would be unrelated scope creep on a pure-documentation finding.

### Blast radius

Single file, comment-only. No behavior change — confirmed via `tsc --noEmit` and the existing test suite both before and after.

### Regression guard

None needed — no behavior changed. `npx tsc --noEmit` clean. `src/lib/admin-zerodte-health.test.ts`: 12/12 pass.

### Gates

`npx tsc --noEmit` — clean. `npx tsx --experimental-test-module-mocks --test src/lib/admin-zerodte-health.test.ts` (Node 20) — 12/12 pass.
