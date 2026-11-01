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

  return (
    stats.find(
      (s) =>
        s.method === catalogEp.method &&
        (s.endpoint === catalogEp.endpoint || s.endpoint.startsWith(prefix))
    ) ?? null
  );
}
