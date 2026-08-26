> **kind:** `FINDING`

## Unsanitized ticker/label values reached `console.warn` template literals in shared Polygon provider code — FIXED

| **Status** | FIXED |
|---|---|

**Root cause.** `src/lib/providers/polygon.ts`'s `fetchStockSnapshot` and
`src/lib/providers/polygon-options-gex.ts`'s `warnChainTruncated`/`polygonFetchUrl` interpolated a
caller-supplied ticker/label/underlying/endpoint string (and, in one case, a caught error's
`.message`) directly into a `console.warn` template literal, with no control-character stripping.
A value containing a newline forges a second, indistinguishable log line — the exact
`js/log-injection` class `src/lib/log-token.ts`'s `logToken()` helper already exists to close (it
was built for the same defect in the Vector wall-persistence layer, per that file's own header
comment). These three call sites predated that helper and were never retrofitted.

**Evidence.** CodeQL flagged 7 new alerts (1 critical SSRF, 6 log-injection/format-string) on PR
#2922 (a Vector feature PR) — "new" only because that PR's route was the first live-HTTP-request
path to reach `resolveTickerChainRows` → these Polygon functions with a value CodeQL treats as
tainted; every prior caller was a cron job with an internally-generated ticker list, so the same
latent gap in the shared provider layer was never exercised from a request boundary before. Of
the 7: the SSRF alert (`api-tracked-fetch.ts:153`) is a **false positive** — `trackedFetch`
already enforces a hardcoded `ALLOWED_FETCH_HOSTS` allowlist and throws *before* calling `fetch()`
if the destination host isn't on it, so a tainted path segment can never redirect the request to
an attacker-controlled host; CodeQL's SSRF query doesn't recognize that allowlist (in a different
function) as a sanitizer. The 6 log-injection alerts were real, in the 3 sites this PR fixes.

**Fix.** Wrapped the tainted interpolations with the existing `logToken()` helper (control chars
replaced with a visible marker, length-capped) at all 3 sites — no new sanitizer invented, reusing
the one this repo already built and tested for exactly this defect class.

**Blast radius.** `fetchStockSnapshot` (polygon.ts:130) and `warnChainTruncated`/`polygonFetchUrl`
(polygon-options-gex.ts) are called from many places repo-wide (cron discovery jobs, dossier
builders, and now the Vector contract-picks route from PR #2922) — the fix is at the log call
site itself, so every caller is covered without touching call sites individually.

**Fix rationale.** Did not touch the SSRF-flagged `trackedFetch`/`api-tracked-fetch.ts` — that
control is already correct (host allowlist enforced before `fetch()`); "fixing" a false positive
there would be pure churn. Did not attempt to make CodeQL's SSRF query recognize the existing
allowlist as a sanitizer (out of scope, tool-configuration work, not a code defect). Per
`log-token.ts`'s own documented tradeoff, `logToken()` uses `new RegExp(string)` rather than a
regex literal (deliberately, to avoid raw control bytes sitting in the source file) — CodeQL may
continue reporting some of these as MEDIUM `js/log-injection` blind spots even after this fix;
that is an accepted, pre-existing analyser limitation this repo already carries at other
`logToken()` call sites, not an unfixed bug.

**Test.** New regression: `polygon-options-gex.test.ts`'s `warnChainTruncated: a newline-bearing
underlying cannot forge a second log line` — pins that a newline-bearing `underlying` produces
exactly one `console.warn` call with no raw newline in the message. `logToken()` itself was
already exhaustively covered by `log-token.test.ts`; the one-line `polygon.ts` change reuses that
same tested helper without new test surface (no cheap seam to unit-test `fetchStockSnapshot`'s
network path without a mock harness this fix doesn't otherwise need).
