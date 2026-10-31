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
      (hasAnchor &&
        (normStat.startsWith(normCatalog.replace("{*}", "")) ||
          normCatalog.includes(normStat.replace("{*}", ""))));

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
