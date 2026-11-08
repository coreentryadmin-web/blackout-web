> **kind:** FINDING

# Admin API-dashboard `matchTelemetry`'s never-called-row fallback reintroduced the exact bare-prefix bug its own primary match was rewritten to avoid

| | |
|---|---|
| **Area** | Admin API dashboard telemetry matching — `src/lib/admin-api-dashboard-match.ts` (`matchTelemetry`) |
| **Severity** | P2 — misattributes a sibling endpoint's status/latency/last_at onto a dashboard tile that has never actually been called |
| **Status** | FIXED |

## Root cause

PR #7273 rewrote `matchTelemetry`'s primary fuzzy match (`endpointSegmentsMatch`) to stop treating
a shared leading path prefix as a match — two catalog endpoints like `/api/stock/{ticker}/nope`
and `/api/stock/{ticker}/max-pain` both start with `/api/stock/`, so a bare `startsWith(prefix)`
check conflated them. That fix covers the case where the catalog row itself HAS telemetry to
disambiguate against a sibling.

It left one branch untouched: the function's final fallback, reached only when a catalog row has
**literally zero stats of its own** recorded this window:

```ts
return (
  stats.find(
    (s) =>
      s.method === catalogEp.method &&
      (s.endpoint === catalogEp.endpoint || s.endpoint.startsWith(prefix))
  ) ?? null
);
```

`prefix` is just the literal text before the first `{placeholder}` segment. For the catalog's
~11 UW `/api/stock/{ticker}/...` rows (plus the Polygon minute/day aggs-bars rows) that all share
that same leading text, a catalog endpoint with zero calls this window (e.g. `nope`) matched ANY
sibling endpoint that DID get called (e.g. `max-pain`) purely because
`"/api/stock/NVDA/max-pain".startsWith("/api/stock/")` is true — the identical unbounded-prefix
defect PR #7273 exists to prevent, one `if` branch later. The dashboard tile for the never-called
endpoint then silently rendered a sibling's status/latency/`last_at`, either masking a genuinely
dead/failing endpoint behind a healthy sibling's green status, or attributing a failing sibling's
red status to an endpoint that was never actually called.

## Evidence (RED → GREEN)

Two new tests in `src/lib/admin-api-dashboard.test.ts`:
- a never-called catalog row (`/api/stock/{ticker}/nope`) must NOT resolve to a same-prefix
  sibling's stat (`/api/stock/NVDA/max-pain`) — must report no match (idle) instead.
- the fallback's actual reason to exist is preserved: a real recorded call whose segment count
  doesn't line up 1:1 with the catalog template (an extra trailing segment the catalog entry
  hasn't been updated to declare) must still resolve to **this row's own** endpoint, never merely
  any same-prefix sibling.

```
pre-fix (bare `startsWith(prefix)` restored): 6/8 pass, 2/8 fail
  - "must NOT fall back to a sibling's bare prefix" fails: resolves to max-pain's stat
  - "still matches its own stat with an unexpected extra trailing segment" fails: resolves to the
    wrong (earlier, same-prefix) sibling instead of the row's own extra-segment stat

post-fix: 8/8 pass
```

Also ran `tsc --noEmit` clean, and confirmed the test exercising PR #7273's original fix (the
"sibling catalog rows" case, where both endpoints DO have their own telemetry) still passes
unchanged.

## Blast radius

Only `matchTelemetry`'s final fallback branch — the primary exact/fuzzy match path (equal
segment-length only) is untouched, and so is every caller of `matchTelemetry`
(`src/app/admin/api-dashboard` and its data-fetch route), which already treat a `null` match as
"idle" and need no change.

## Fix rationale

Added `endpointPrefixSegmentsMatch`, a positional segment walk that requires every one of the
catalog endpoint's own literal segments to agree positionally with the candidate (a wildcard
`{placeholder}` segment matches anything), while tolerating the candidate having **extra trailing
segments** the catalog template doesn't declare — the one real case the primary equal-length match
can't cover by construction, and the actual reason this fallback branch exists at all. This keeps
the fallback's intended narrow purpose (a genuinely-matching row whose segment count has drifted
from the catalog) while closing the sibling-collision hole. Left unchanged: the primary
`endpointSegmentsMatch` match (already correct per #7273), the overall "idle if no match" policy,
and every other branch of `matchTelemetry`.
