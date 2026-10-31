> **kind:** FINDING

## `isUwPathLiveIntegrated` prefix fallback false-matched 40 of 186 documented UW endpoints as "live integrated" — FIXED

**Status:** FIXED (`fix/uw-live-integration-prefix-match`)

### Root cause

`src/lib/live-api-integrations.ts`'s `isUwPathLiveIntegrated(pathTemplate)` is the function
`admin-endpoint-registry.ts` uses to decide whether a documented Unusual Whales REST endpoint is
actually wired into the app (`usedInCode = doc.usedInCode || sourceFiles.length > 0 ||
liveIntegrated`, and `integrationCandidate: !usedInCode && doc.probe.ok`).

Before this fix, in addition to a correct full-path normalized match (`{param}` segments collapsed
to a wildcard so differing placeholder names still line up), the function had a second fallback:

```ts
const prefix = pathTemplate.split("{")[0];
const livePrefix = live.split("{")[0];
if (prefix && livePrefix && prefix === livePrefix) return true;
```

`split("{")[0]` only keeps the STATIC text *before the first* `{param}` placeholder — for the vast
majority of UW REST paths that is a very short, shared root like `/api/stock/` or `/api/economy/`,
not anything identifying the specific endpoint. So this fallback returned `true` for ANY two paths
sharing that short root, completely ignoring everything after the first placeholder — i.e. the part
of the path that actually names the endpoint.

### Evidence

Live repro against the real catalogs (`UW_REST_SECTIONS` from `uw-docs-catalog.ts` vs
`UW_FETCH_FUNCTION_PATHS`/`UW_WS_CHANNELS` from `live-api-integrations.ts`, pre-fix):

```
isUwPathLiveIntegrated("/api/stock/{ticker}/totally-made-up-endpoint-xyz") === true
isUwPathLiveIntegrated("/api/economy/{indicator}/made-up-sub-path") === true
```

Neither path exists anywhere in `UW_FETCH_FUNCTION_PATHS` or `UW_WS_CHANNELS` — they share only the
static root before the first `{}` with *some* real entry in those maps.

Scanning the full 186-endpoint documented catalog (`UW_REST_SECTIONS`) against the live set found
**40 false positives** — genuinely unwired endpoints the prefix fallback nonetheless reported as
"live integrated", e.g.:

```
/api/stock/{ticker}/balance-sheets
/api/stock/{ticker}/insider-buy-sells
/api/stock/{ticker}/ownership
/api/stock/{ticker}/earnings
/api/stock/{ticker}/financials
/api/stock/{ticker}/option-contracts
/api/stock/{ticker}/greeks
... (40 total, see test file for the representative subset asserted)
```

Only 30 of the 186 documented endpoints are genuine exact (normalized) matches against
`UW_FETCH_FUNCTION_PATHS`/`UW_WS_CHANNELS` — the prefix fallback alone was responsible for more
false "integrated" verdicts (40) than there are real integrations (30).

### Blast radius

Single call site: `admin-endpoint-registry.ts` line ~330, gated to `providerId ===
"unusual_whales"`. Its only consumer is the admin "API Coverage" dashboard
(`aggregateProviderHealth`/`summarizeDocumentationCoverage`/`buildEndpointRegistry`), which exists
specifically to surface documented-but-unused endpoints as integration candidates
(`integrationCandidate: !usedInCode && doc.probe.ok`). The bug silently hid 40 of those candidates
from that list — the exact opposite of the panel's purpose — without touching any member-facing
code path, any other provider (Polygon/Massive/etc. never hit this function), or any runtime
behavior outside the admin dashboard.

### Fix rationale

Removed the prefix fallback entirely. The remaining full-path normalized-match check (`{param}` →
`{*}` across the WHOLE path, not just up to the first one) already correctly handles the one
legitimate case the fallback could have been for — a live path using a differently-named
placeholder than the doc catalog (`{ticker}` vs `{symbol}`) — while a regression test
(`UW_FETCH_FUNCTION_PATHS entries all round-trip through isUwPathLiveIntegrated`) confirms every
real integration still matches itself post-fix. No alternative "smarter" prefix heuristic was
written: the normalized full-path match is the correct general rule, and no caller needed anything
looser once that's confirmed sufficient (30/30 real integrations still match; 0/40 false positives
remain).

Also left the dead/narrower `/api/socket/` branch's behavior unchanged in spirit — WS channel paths
still match via the same normalized full-path comparison (verified in the new test), since it never
needed to be a special case to begin with.

### Test

`src/lib/live-api-integrations.test.ts` (new). RED→GREEN proven via `git stash` on the source file
alone: the "documented-but-unwired sibling endpoint" test fails on pre-fix code (asserts `false`,
got `true` for `/api/stock/{ticker}/balance-sheets` etc.) and passes after the fix. `tsc --noEmit`
clean; `admin-endpoint-registry.test.ts` (existing, unmodified) still green.
