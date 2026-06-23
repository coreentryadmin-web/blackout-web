import { recordApiCall } from "@/lib/api-telemetry";
import { captureError } from "@/lib/error-sink";

const MAX = 40;
const errors: Array<{ route: string; message: string; at: string }> = [];

export function recordAdminRouteError(route: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const at = new Date().toISOString();
  errors.unshift({ route, message, at });
  if (errors.length > MAX) errors.length = MAX;
  console.error(`[${route}]`, error);

  recordApiCall({
    provider: "blackout_engine",
    endpoint: route,
    method: "ROUTE",
    status: 500,
    ok: false,
    latency_ms: 0,
    error: message,
    phase: "failure",
    synthetic: true,
  });

  // Durable sink (no-op unless DATABASE_URL / SENTRY_DSN set). Fire-and-forget:
  // must never throw into the route's catch block or delay the response.
  void captureError(error, { source: "admin_route", scope: route });
}
export function getAdminRouteErrors(): typeof errors {
  return [...errors];
}
