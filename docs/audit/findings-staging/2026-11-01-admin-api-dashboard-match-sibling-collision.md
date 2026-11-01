> **kind:** FINDING

## Admin API dashboard: sibling catalog endpoints sharing one prefix stole each other's telemetry

| | |
|---|---|
| **Area** | `src/lib/admin-api-dashboard-match.ts` (consumed by `admin-api-dashboard.ts`, the Admin → API dashboard data source) |
| **Status** | FIXED (PR, branch `fix/admin-api-dashboard-match-sibling-collision`) |
| **Severity** | P2 — operator-facing provider-health dashboard silently shows the wrong endpoint's status/latency for roughly a dozen real catalog rows |

### Root cause

`matchTelemetry()` decides which recorded `ApiEndpointStats` row belongs to a given
`CatalogEndpoint` template (e.g. `"/api/stock/{ticker}/nope"`). Its "fuzzy" match compared
`normalizeEndpointKey()` output using:

```ts
normStat.startsWith(normCatalog.replace("{*}", "")) ||
normCatalog.includes(normStat.replace("{*}", ""))
```

`String#replace(pattern, repl)` with a plain string pattern (no `/g` flag) replaces only the
**first** occurrence. For any catalog endpoint whose placeholder is **not the final path
segment** — i.e. there is literal text *after* the placeholder — that literal text is never
compared at all. Both branches only ever test the text up to (or immediately around) the
first `"{*}"` token.

Concretely: `"/api/stock/{ticker}/max-pain"` and `"/api/stock/{ticker}/nope"` (and ~9 other
real UW per-ticker catalog rows: `spot-exposures`, `spot-exposures/expiry-strike`,
`volatility/stats`, `flow-per-strike-intraday`, `flow-alerts`, `net-prem-ticks`,
`oi-change`, `implied-volatility-term-structure`) all share the identical literal prefix up
to their first `{ticker}` placeholder: `"/api/stock/"`. The literal suffix (`"max-pain"` vs
`"nope"`) is what actually distinguishes them — and the broken fuzzy check never looked at
it, so it failed for *every* real recorded stat of *every* one of these endpoints. Same shape
for Polygon's `"/v2/aggs/ticker/{symbol}/range/1/minute/{from}/{to}"` vs
`".../range/1/day/{from}/{to}"` (`"minute"` vs `"day"` sit after the first placeholder).

With the fuzzy check never succeeding, `best` stayed `null` for every one of these rows, and
every single one fell through to the function's own final fallback:

```ts
return stats.find(s => s.method === catalogEp.method &&
  (s.endpoint === catalogEp.endpoint || s.endpoint.startsWith(prefix))) ?? null;
```

`prefix` (`catalogEp.endpoint.split("{")[0]`) is the SAME `"/api/stock/"` string for every one
of those ~11 sibling rows, so `.find()` returns whichever UW per-ticker stat happens to sit
first in the (unsorted-by-endpoint) stats array — not necessarily this row's own stat.

### Evidence

Reproduced directly against the shipped (pre-fix) function:

```
max-pain catalog -> /api/stock/NVDA/max-pain
nope catalog     -> /api/stock/NVDA/max-pain   // WRONG — nope's own stat ("/api/stock/TSLA/nope") never considered
```

and the Polygon aggs-bars pair:

```
day catalog    -> /v2/aggs/ticker/:sym/range/1/minute/...   // WRONG — this is the MINUTE stat
minute catalog -> /v2/aggs/ticker/:sym/range/1/minute/...   // happens to be right only because it's first in the array
```

Two new regression tests in `src/lib/admin-api-dashboard.test.ts`
("sibling catalog rows sharing one prefix…" and "sibling aggs-bars rows (minute vs day)…")
encode exactly this: with `git stash` reverting only `admin-api-dashboard-match.ts`, both new
tests fail (confirmed: `2 fail / 4 pass` on the unmodified function); with the fix restored,
all 6 tests in the file pass.

### Blast radius

Every real catalog row whose placeholder is followed by more literal path text and which
shares its pre-placeholder prefix with a sibling row is affected — confirmed from
`src/lib/api-provider-catalog.ts`:
- `unusual_whales`: the ~11 `/api/stock/{ticker}/...` rows (max-pain, nope, spot-exposures,
  spot-exposures/expiry-strike, volatility/stats, flow-per-strike-intraday, flow-alerts,
  net-prem-ticks, oi-change, implied-volatility-term-structure) — all share `"/api/stock/"`.
- `polygon`: the "Intraday 1-minute bars" / "Session VWAP" (duplicate same-endpoint rows) vs
  "Daily bars" rows — share `"/v2/aggs/ticker/"`.

The consumer is `fetchAdminApiDashboard()` in `src/lib/admin-api-dashboard.ts` (`matchTelemetry`
is its only call site), which feeds the Admin → API dashboard's per-endpoint status/latency
display — an operator-facing health surface. The practical effect: a genuinely failing
endpoint (e.g. a 503 on `nope`) could render as healthy (showing a different, healthy
sibling's 200), and vice versa — exactly the kind of false-positive/false-negative an ops
health dashboard exists to prevent.

### Fix rationale

Replaced the two brittle, first-occurrence-only string manipulations with
`endpointSegmentsMatch()`: split both the catalog template and the candidate endpoint on `"/"`,
require equal segment counts, and require every segment to match literally EXCEPT at a
position where the catalog has a `"{placeholder}"` (which matches any real segment there,
regardless of whatever token scheme `api-telemetry.ts`'s `endpointTemplate()` collapsed it
to). This is structurally correct for any number of placeholders at any position, not just a
trailing one, and does not depend on knowing the specific placeholder/token conventions used
on either side.

Deliberately left unchanged:
- The existing `hasAnchor` guard (and the `/{proxy}` catch-all regression test it protects,
  PR #7093) — `endpointSegmentsMatch` is still gated behind `hasAnchor` exactly where the old
  fuzzy checks were, so a fully-wildcard catalog row still returns `null` rather than stealing
  another endpoint's stat.
- The final bare-prefix fallback (reached only when NO stat's shape matches at all, i.e. the
  endpoint has genuinely never been called) — tightening that further is a separate, lower-
  severity question (a cold/never-called endpoint showing a sibling's stale status) and is out
  of scope for this fix, which targets the much worse case of two ACTIVELY-reporting sibling
  endpoints cross-attributing real, differing telemetry.
- `normalizeEndpointKey()` and its digit-collapsing — still used for the cheap exact-normalized
  equality check, which `endpointSegmentsMatch` does not replace, only supplements.
