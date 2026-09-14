## 2026-09-14 — [FINDING, P3 CI/tooling — FIXED] `seo-visibility-audit.mjs`'s `fetchPublic()` never used the retry helper it already had, so a transient connection reset failed the whole Deploy-smoke gate

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED — `fetchPublic()` now goes through `curlRetry()` instead of a bare `curl()`. |
| **Severity** | P3 — CI reliability, not a production/data-correctness defect. Low frequency (2 live occurrences found), but each one is a fully RED `Deploy smoke` run over a single retryable network blip. |

### What was broken

Live `Deploy smoke` CI history shows two RED runs, both on the exact same failure shape:

- **2026-09-13 22:41:44 UTC** (run 34787413253): `curl: (35) Recv failure: Connection reset by peer` fetching `sitemap.xml` → `[FAIL] sitemap.xml — HTTP 0` → `=== RED — 22 checks, 1 fail ===`
- **2026-09-14 06:50:42 UTC** (run 34815012161): same error fetching `robots.txt` → `[FAIL] robots.txt — HTTP 0` → same rollup shape

Both are a single transient `curl` connection reset, immediately after a deploy — 21/22 (or equivalent) other checks passed cleanly in the same run. The repo already has a purpose-built helper for exactly this: `curlRetry()` (wraps `curl()` with up to 4 retries, gated by `isRetryableCurlResult()`, which explicitly matches `/reset|timed out|connection|ECONN|Recv failure/i` in the curl error string — this failure shape verbatim). It's already wired into the Clerk FAPI auth mint path in the same script (`seo-visibility-audit.test.mjs` even has a standing regression test asserting that: `"seo-visibility-audit uses curlRetry on Clerk FAPI mint path"`).

**`fetchPublic()` — the function backing all 9 public SEO checks, including the two that actually failed live (`robots.txt`, `sitemap.xml`, plus `/tools/gamma-snapshot`, `/vs/others`, `/llms.txt`, `/`, `/pricing`, `/learn`, and the pillar page) — called plain `curl()`, not `curlRetry()`.** The retry infrastructure existed and was proven to work for the auth path; it just wasn't connected to the path that turned out to actually need it in production.

### Fix

`fetchPublic()` now calls `curlRetry({...})` instead of `curl({...})` — one-line change, same call shape, no behavior change on a successful first attempt (retries are a no-op unless `isRetryableCurlResult` matches). Every one of the 9 call sites benefits, not just the two that happened to fail first.

### Test (RED→GREEN proven)

Added `seo-visibility-audit's fetchPublic retries through curlRetry, not a bare curl` to `scripts/audit/seo-visibility-audit.test.mjs` — a source-grep test matching the existing style in the same file (the script authenticates against live Clerk/prod, so these are all static-analysis regression tests, not live-integration ones). Verified via `git stash` on just the `.mjs` fix: the new test fails against the pre-fix source (`AssertionError [ERR_ASSERTION]: The input did not match the regular expression /await curlRetry\(/`) and passes after. Full file: 4/4 pass on Node 20 (`npx tsx --experimental-test-module-mocks --test scripts/audit/seo-visibility-audit.test.mjs`). `node --check` clean.

### Not touched

`isRetryableCurlResult`/`curlRetry`/`seoAuditExitCode` themselves are unchanged — they were already correct and already covered by tests; this was purely a wiring gap on one call site's caller.
