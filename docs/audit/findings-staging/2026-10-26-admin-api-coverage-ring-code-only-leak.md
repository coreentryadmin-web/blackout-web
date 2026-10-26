> **kind:** `FINDING`

## Admin API dashboard's Coverage ring and provider chips let code-only discoveries inflate the used-count numerator — FIXED

**Status.** FIXED (PR #6788, open).

### Area

`/admin?tab=apis` (DISCOVERY-lane, non-owned) — `src/lib/admin-endpoint-registry.ts`'s
`buildEndpointRegistry`, consumed by `AdminApiDashboard.tsx`'s Coverage ring and per-provider chip
strip.

### Found by

Live-UI sweep via `proxy-browser.cjs` against prod `/admin?tab=apis` (desktop, temp admin Clerk
session, `Routed: 102 ok, 0 fail`).

### Symptom

Live screenshot: the "anthropic" and "blackout engine" provider chips read **"1/0 used"** — more
used than documented, backwards for a label reading `{used}/{documented} used`. Live numbers
elsewhere on the same page: DOCUMENTED 265, IN CODE 213, UNUSED 73 — `213 + 73 = 286 ≠ 265`, a
21-row leak — rendered as an **80.4% Coverage** ring, honestly `192/265 = 72.5%`.

### Root cause

`buildEndpointRegistry` built a flat `rows` array covering both documented endpoints (from the
docs-probe catalog, `documented: true`) and codebase-scan-only discoveries (endpoints with a real
call site but no catalog entry, `documented: false`, always `usedInCode: true` by construction —
the `codeOnlyPaths` loop). Both the per-provider `usedTotal` and the top-level `used_in_code`
counted **every** row with `usedInCode: true`, never gating on `row.documented` — so a code-only
row (not a subset of the documented set the denominator counts) inflated both numerators. A
provider with zero documented endpoints and one code-only call site rendered "1/0 used"; at the
aggregate level the same leak inflated the headline Coverage percentage.

### Fix

Extracted the aggregation into two pure, exported, now-tested functions
(`aggregateProviderHealth`, `summarizeDocumentationCoverage`) and gated both `usedTotal`/
`usedInCode` on `row.documented`, matching what the UI labels already claim. `codeOnlyPaths` (the
existing, correctly-scoped signal for "used but undocumented") is untouched — nothing is lost, the
fix only stops double-counting it into a denominator it doesn't belong to.

### Evidence

RED→GREEN via `git stash` on the lib-only change: 2 new unit tests
(`src/lib/admin-endpoint-registry.test.ts`) fail pre-fix (`is not a function`, since the fix
extracts the functions), pass post-fix. `npx tsc --noEmit` clean. Full suite: 16992 pass / 0 fail
/ 3 pre-existing skips (unrelated).

### Blast radius

`buildEndpointRegistry` has exactly one consumer path: `src/lib/admin-api-dashboard.ts` →
`AdminApiDashboard.tsx` (confirmed via grep). No other call sites.
