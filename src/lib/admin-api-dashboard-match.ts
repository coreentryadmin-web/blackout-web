// Pure endpoint-telemetry matching for the admin API dashboard
// (src/lib/admin-api-dashboard.ts). Kept in its own dependency-free module — unlike
// admin-api-dashboard.ts itself, which transitively pulls in server-only providers
// (db/polygon/uw sockets) — so this logic is unit-testable without a server runtime.
import type { ApiProviderId } from "@/lib/api-telemetry-types";
import type { ApiEndpointStats } from "@/lib/api-telemetry-types";
import type { CatalogEndpoint } from "@/lib/api-provider-catalog";

export function normalizeEndpointKey(endpoint: string): string {
  return endpoint.replace(/\{[^}]+\}/g, "{*}").replace(/\/\d+/g, "/{*}");
}

/**
 * True when `candidateEndpoint` could be a real recorded instance of `catalogEndpoint`'s
 * template: split both on "/" and require every segment to agree EXCEPT at a position where
 * the catalog has a "{placeholder}" (which matches any real segment there, whatever
 * api-telemetry.ts's endpointTemplate() collapsed it to — a literal ticker, a ":sym"/":date"
 * token, or a raw digit sequence; this function does not need to know which).
 *
 * Root cause this replaces: the previous check compared `normalizeEndpointKey()` output with
 * `.replace("{*}", "")` (String#replace with no "g" flag — ONE occurrence only) and an
 * unanchored `.startsWith`/`.includes`. That silently fails for any catalog endpoint whose
 * placeholder is NOT the final segment, because every literal segment AFTER the placeholder
 * (e.g. "range/1/minute" vs "range/1/day", or "max-pain" vs "nope") never gets compared at
 * all — both branches only ever test the text up to (or around) the first "{*}". With no
 * stat ever passing this broken "fuzzy" test, every such row silently fell through to the
 * final bare-prefix fallback below, which cannot discriminate between sibling catalog rows
 * that share the same literal text before their FIRST placeholder — confirmed live-shape:
 * "/api/stock/{ticker}/nope" and "/api/stock/{ticker}/max-pain" (and ~9 other UW per-ticker
 * rows) all share the "/api/stock/" prefix, so the "nope" dashboard row silently displayed
 * whichever per-ticker UW stat the ring buffer happened to list first — e.g. a stale
 * "max-pain" failure rendering as a "nope" outage, or a healthy "max-pain" call masking a
 * genuinely failing "nope" endpoint. Same shape for Polygon's "minute" vs "day" aggs-bars
 * rows, which also share one literal prefix before their first "{symbol}" placeholder.
 */
function endpointSegmentsMatch(catalogEndpoint: string, candidateEndpoint: string): boolean {
  const catalogParts = catalogEndpoint.split("/");
  const candidateParts = candidateEndpoint.split("/");
  if (catalogParts.length !== candidateParts.length) return false;
  for (let i = 0; i < catalogParts.length; i++) {
    const seg = catalogParts[i];
    if (seg.startsWith("{") && seg.endsWith("}")) continue; // wildcard position
    if (seg !== candidateParts[i]) return false;
  }
  return true;
}

/**
 * Looser cousin of `endpointSegmentsMatch`, for the never-called-endpoint fallback below.
 * Walks the catalog's segments positionally against the candidate's (placeholder = wildcard,
 * same as above) but, unlike `endpointSegmentsMatch`, tolerates the CANDIDATE having extra
 * trailing segments the catalog template doesn't declare (e.g. a recorded path that grew a
 * segment the catalog entry hasn't been updated to list). It still requires every one of the
 * catalog's own literal segments to agree positionally, so it canNOT be satisfied by a sibling
 * row that only shares a leading prefix — see the bug this replaces, below.
 *
 * Root cause this replaces: PR #7273 fixed the PRIMARY fuzzy match (`endpointSegmentsMatch`
 * above) but left the final fallback as a bare `s.endpoint.startsWith(prefix)` — the exact same
 * unbounded-prefix bug the whole function was rewritten to avoid, just one branch down, for the
 * one case the primary match can't cover by definition: a catalog endpoint with literally ZERO
 * stats of its own recorded yet. `prefix` is only the text BEFORE the first "{placeholder}", so
 * for the ~11 UW "/api/stock/{ticker}/..." rows (and the Polygon minute/day aggs-bars rows) that
 * all share that same leading text, a catalog row that has never once been called (e.g. "nope")
 * still matched ANY sibling row that HAS been called (e.g. "max-pain") purely because
 * "/api/stock/NVDA/max-pain".startsWith("/api/stock/") is true — misattributing a stale/failing
 * sibling's status, latency and last_at to this row's dashboard tile, or masking a genuinely
 * failing row behind a healthy sibling's green status. Confirmed live-shape with the real
 * catalog: a session scoped with zero "nope" telemetry but live "max-pain" telemetry.
 */
function endpointPrefixSegmentsMatch(catalogEndpoint: string, candidateEndpoint: string): boolean {
  const catalogParts = catalogEndpoint.split("/");
  const candidateParts = candidateEndpoint.split("/");
  if (candidateParts.length < catalogParts.length) return false; // candidate can't be shorter
  for (let i = 0; i < catalogParts.length; i++) {
    const seg = catalogParts[i];
    if (seg.startsWith("{") && seg.endsWith("}")) continue; // wildcard position
    if (seg !== candidateParts[i]) return false;
  }
  return true;
}

export function matchTelemetry(
  catalogEp: CatalogEndpoint,
  _provider: ApiProviderId,
  stats: ApiEndpointStats[]
): ApiEndpointStats | null {
  const normCatalog = normalizeEndpointKey(catalogEp.endpoint);
  const prefix = catalogEp.endpoint.split("{")[0];
  // A catalog endpoint whose ENTIRE path is one dynamic segment — e.g. blackout_engine's
  // "/{proxy}" catch-all row — has no literal text before its placeholder. Stripping its
  // sole "{*}" token (normalizeEndpointKey("/{proxy}") -> "/{*}") collapses the normalized
  // key to a bare "/", which is a prefix AND substring of every real endpoint string. Without
  // this guard, `normStat.startsWith(normCatalog.replace("{*}", ""))` below and the final
  // `s.endpoint.startsWith(prefix)` fallback both trivially pass for ANY stat from the same
  // provider — confirmed live-shape: the "/{proxy}" row silently claims "/health"'s own stat
  // purely because "/health".startsWith("/") is true, mislabeling the health probe's
  // status/latency/last_at as "Catch-all engine proxy routes" traffic in the admin dashboard.
  // `prefix.length > 1` means there is at least one real literal character to anchor on
  // (more than the bare leading "/" every endpoint shares).
  const hasAnchor = prefix.length > 1;
  let best: ApiEndpointStats | null = null;

  for (const s of stats) {
    // Method must always agree — a fuzzy/prefix match across HTTP methods on the same
    // literal path (e.g. a GET catalog row picking up a POST call) was previously only
    // guarded on the `exact` branch and the final fallback, not here.
    if (s.method !== catalogEp.method) continue;
    const normStat = normalizeEndpointKey(s.endpoint);
    const exact = s.endpoint === catalogEp.endpoint;
    const fuzzy =
      normStat === normCatalog ||
      (hasAnchor && endpointSegmentsMatch(catalogEp.endpoint, s.endpoint));

    if (exact || fuzzy) {
      if (!best || (s.last_at && (!best.last_at || s.last_at > best.last_at))) {
        best = s;
      }
    }
  }

  if (best) return best;
  // No literal anchor at all: a bare prefix-startsWith fallback here would be exactly the
  // same unbounded match the guard above exists to prevent — better to honestly report no
  // match (idle) than to attribute an unrelated endpoint's traffic to this row.
  if (!hasAnchor) return null;

  // Reached only when this catalog row has literally ZERO stats satisfying the exact/fuzzy
  // check above (every real call this provider has made this window is for a DIFFERENT
  // endpoint). `endpointPrefixSegmentsMatch` — not a bare `startsWith(prefix)` — so a sibling
  // row sharing only the leading literal text (e.g. "max-pain" vs this row's "nope") still
  // cannot be mistaken for this row's own telemetry; see that function's doc comment.
  return (
    stats.find(
      (s) => s.method === catalogEp.method && endpointPrefixSegmentsMatch(catalogEp.endpoint, s.endpoint)
    ) ?? null
  );
}
