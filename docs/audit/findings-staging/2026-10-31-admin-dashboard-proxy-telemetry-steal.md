> **kind:** FINDING

## Admin API dashboard: the `/{proxy}` catch-all row silently steals another endpoint's telemetry — FIXED

| | |
|---|---|
| **Area** | `src/lib/admin-api-dashboard.ts` (admin `/api/admin/api-dashboard` panel — per-provider/per-endpoint health rows) |
| **Status** | FIXED |
| **Severity** | P3 — admin-only observability surface, no member-facing impact, no data corruption |

### Root cause

`matchTelemetry(catalogEp, provider, stats)` tries to attach the right recorded telemetry
(`ApiEndpointStats`) to each row of the static `API_PROVIDER_CATALOG`. It normalizes both the
catalog's templated endpoint and each real recorded stat's literal endpoint by collapsing path
parameters to a `"{*}"` token (`normalizeEndpointKey`), then fuzzy-matches by stripping that token
back out:

```ts
const fuzzy =
  normStat === normCatalog ||
  normStat.startsWith(normCatalog.replace("{*}", "")) ||
  normCatalog.includes(normStat.replace("{*}", ""));
```

and, failing that, falls back to a literal-prefix match:

```ts
const prefix = catalogEp.endpoint.split("{")[0];
return stats.find((s) => s.method === catalogEp.method && (s.endpoint === catalogEp.endpoint || s.endpoint.startsWith(prefix)));
```

Both of these assume the catalog endpoint has some literal text *before* its first path
parameter to anchor on. The `blackout_engine` provider's catch-all row —

```ts
{ endpoint: "/{proxy}", method: "GET", description: "Catch-all engine proxy routes", used_by: ["/api/engine/*"] }
```

— has **no literal prefix at all**: its entire path is one dynamic segment. Normalizing it gives
`"/{*}"`, and stripping the sole `"{*}"` token collapses that to a bare `"/"` — which is a prefix
(and substring) of literally every endpoint string. So for this one row, `normStat.startsWith("/")`
and `s.endpoint.startsWith("/")` both trivially pass for **any** stat from the same provider, not
just real catch-all proxy calls.

Concretely: `blackout_engine` also has two other, more specific catalog rows (`"/health"`,
`"/spx/state"`). When `fetchApiDashboard` builds the `/{proxy}` row, `matchTelemetry` loops over
every recorded `blackout_engine` stat — including `/health`'s own, frequently-refreshed probe
stat — and because the degenerate prefix check passes for all of them, it picks whichever has the
most recent `last_at`. In practice that is almost always the health probe (it fires far more often
than genuine `/api/engine/*` proxy traffic), so the admin dashboard's "Catch-all engine proxy
routes" row silently displays `/health`'s status/latency/last-call-time as if it were real proxy
traffic — a misattribution, not a crash, but exactly the kind of "looks live, isn't what it says"
defect this repo's audit discipline treats as a real bug (see the `public-gex-snapshot-types.ts`
wall-labeling fixes for the same "the data is right, the LABEL is wrong" shape).

A second, narrower gap in the same function: the `fuzzy` branch never checked
`s.method === catalogEp.method` (only the `exact` branch and the final fallback did), so a
same-path-different-method stat could in principle also be fuzzy-matched onto the wrong catalog
row. No current catalog entry has two methods on the same literal path, so this specific gap isn't
yet live-triggerable, but it's the same class of bug and is fixed in the same place.

### Evidence

Confirmed with the pre-fix logic (via `git stash`) against a synthetic case mirroring the real
catalog shape: calling `matchTelemetry({ endpoint: "/{proxy}", method: "GET" }, "blackout_engine",
[{ endpoint: "/health", method: "GET", last_at: "2026-10-30T12:00:00.000Z", ... }])` returns the
`/health` stat (wrong — RED), where it must return `null` (no genuine catch-all stat was ever
recorded — GREEN after the fix). A second case in the same RED run confirmed the missing
method check: a `POST /v1/marketstatus/now` stat matched the `GET /v1/marketstatus/now` catalog
row. Both pass after the fix; two additional regression cases (a single-param endpoint and a
real multi-param endpoint, `/v2/aggs/ticker/{symbol}/range/1/minute/{from}/{to}`, matching the
`polygon` catalog's own duplicated entry) confirm no regression on the normal, anchored-prefix
matching path. Full RED→GREEN run: `npx tsx --experimental-test-module-mocks --test
src/lib/admin-api-dashboard.test.ts` (4/4 pass post-fix; 2/4 fail pre-fix).

### Blast radius

Only `matchTelemetry` inside `src/lib/admin-api-dashboard.ts`, and only the single `blackout_engine`
`"/{proxy}"` catalog row is degenerate enough to trigger the broad-match defect today (no other
catalog endpoint across any provider has zero literal prefix). The missing method-check fix is
inert against the current catalog (no path is reused across two HTTP methods) but closes the same
bug class everywhere else in the function. No other consumer of `ApiEndpointStats`/`CatalogEndpoint`
is affected — this function's only caller is `fetchApiDashboard`, which only feeds the admin
dashboard payload.

### Fix rationale

Extracted the pure matching logic (`normalizeEndpointKey` + `matchTelemetry`) into a new,
dependency-free module, `src/lib/admin-api-dashboard-match.ts` — `admin-api-dashboard.ts` itself
transitively imports several server-only providers (`db`, Polygon/UW socket stores), so the pure
function couldn't be unit-tested in place without pulling in that whole chain (confirmed: importing
it directly throws `Error: This module cannot be imported from a Client Component module` from the
`server-only` package deep in the import graph). This mirrors the repo's existing pattern of
splitting pure helpers from heavy route/provider files for testability (e.g. `lib/e2e-schema-checks.mjs`,
`lib/zerodte-healthcheck-eval.mjs` in the audit toolkit).

The fix itself: compute `hasAnchor = prefix.length > 1` (more than the bare leading `"/"` every
endpoint shares) and gate BOTH the fuzzy startsWith/includes checks and the final prefix fallback
on it. When a catalog endpoint has no literal anchor at all, the function now honestly returns
`null` (idle) rather than borrowing an unrelated endpoint's traffic — consistent with this repo's
"absence is information, fabrication corrupts it" principle applied elsewhere (e.g. `gex_evaluated`
on `FlowAlert`, `ledger: null` on Helix signal outcomes). Also added the missing
`s.method === catalogEp.method` check to the `fuzzy` branch so it can never disagree with the
`exact` branch and the fallback on whether method matters. Nothing about the matching contract for
every OTHER (properly-anchored) catalog endpoint changed — verified by the two added no-regression
test cases.

### Files changed

- `src/lib/admin-api-dashboard-match.ts` (new) — pure `normalizeEndpointKey`/`matchTelemetry`,
  with the anchor guard and method-check fixes.
- `src/lib/admin-api-dashboard.ts` — now imports `matchTelemetry` from the new module instead of
  defining it inline; no other behavior change.
- `src/lib/admin-api-dashboard.test.ts` (new) — 4 regression cases (RED→GREEN proven via
  `git stash`).
