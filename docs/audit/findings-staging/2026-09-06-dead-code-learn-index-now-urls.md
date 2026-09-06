# 2026-09-06 — Dead code: `learnIndexNowUrls` (zero real callers) — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P4 |
| **Area** | SEO / IndexNow |
| **PR** | (this branch) |

## Symptom

`src/lib/seo/sitemap-urls.ts` exported `learnIndexNowUrls()`, marked `@deprecated Use
indexNowUrls — kept for callers that only ping learn paths." Same shape as the
`largoModuleStarterCards` dead-code fix earlier today (#4118): a `@deprecated` export whose
"kept for callers" rationale no longer had any callers to be kept for.

## Fix

Repo-wide grep (`learnIndexNowUrls`, excluding `node_modules`) returned exactly one match before
the fix — the function's own definition. No test file referenced it either. Deleted the function.
`indexNowUrls()` (the superset it says to use instead) is untouched and still the one real export
IndexNow callers use.

## Evidence

- `grep -rln "learnIndexNowUrls"` before the fix: 1 file (the definition itself).
- `grep -rln "learnIndexNowUrls"` after the fix: 0 files.
- `sitemap-urls.test.ts`: 4/4 pass post-removal.
- `tsc --noEmit`: clean.

## Blast radius

`sitemap-urls.ts` only. No other file referenced the deleted function.
