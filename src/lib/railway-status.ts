// BLACKOUT Intelligence Engine — Layer 3 diagnostic Railway probes. Read-only:
// deploy status/commit history, resource usage (CPU/memory), env-var presence
// audit, and recent runtime error counts, all via the Railway GraphQL API.
// Never mutates anything — no redeploy, no env var writes, no value reads (the
// env-var audit discards every value the instant it reads the key names; see
// probeRailwayEnvVars). Railway auto-injects RAILWAY_PROJECT_ID/
// RAILWAY_ENVIRONMENT_ID/RAILWAY_SERVICE_ID into every deployment's own
// runtime, so the only new configuration any of this needs is RAILWAY_TOKEN
// (a project-scoped Project-Access-Token) as a real service env var.

const RAILWAY_GRAPHQL_URL = "https://backboard.railway.com/graphql/v2";

type RailwayEnvIds = { token: string; projectId: string; environmentId: string; serviceId: string };

function readRailwayEnv(): RailwayEnvIds | null {
  const token = process.env.RAILWAY_TOKEN?.trim();
  const projectId = process.env.RAILWAY_PROJECT_ID?.trim();
  const environmentId = process.env.RAILWAY_ENVIRONMENT_ID?.trim();
  const serviceId = process.env.RAILWAY_SERVICE_ID?.trim();
  if (!token || !projectId || !environmentId || !serviceId) return null;
  return { token, projectId, environmentId, serviceId };
}

async function railwayGraphQL<T>(token: string, query: string, variables: Record<string, unknown>): Promise<
  { ok: true; data: T } | { ok: false; error: string }
> {
  try {
    const res = await fetch(RAILWAY_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Project-Access-Token": token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { ok: false, error: `Railway API HTTP ${res.status}` };
    const json = (await res.json()) as { data?: T; errors?: Array<{ message?: string }> };
    if (json.errors?.length) return { ok: false, error: json.errors[0]?.message ?? "Railway GraphQL error" };
    if (json.data == null) return { ok: false, error: "Railway GraphQL returned no data" };
    return { ok: true, data: json.data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Railway probe failed" };
  }
}

export type RailwayDeploymentSummary = {
  status: string;
  createdAt: string;
  commitHash: string | null;
  commitMessage: string | null;
};

export type RailwayStatus =
  | { configured: false }
  | { configured: true; ok: false; error: string }
  | { configured: true; ok: true; deployments: RailwayDeploymentSummary[] };

type RailwayDeploymentEdge = {
  node: {
    status: string;
    createdAt: string;
    meta?: Record<string, unknown> | null;
  };
};

type RailwayDeploymentsResponse = {
  deployments?: { edges?: RailwayDeploymentEdge[] };
};

/** Pure mapper: raw GraphQL deployment edges → the summary shape this module
 *  exposes. Split out from the fetch so the shape logic is unit-testable without
 *  a network call. */
export function mapDeploymentEdges(edges: RailwayDeploymentEdge[] | undefined): RailwayDeploymentSummary[] {
  if (!edges) return [];
  return edges.map((e) => ({
    status: String(e.node.status),
    createdAt: String(e.node.createdAt),
    commitHash: typeof e.node.meta?.commitHash === "string" ? e.node.meta.commitHash : null,
    commitMessage: typeof e.node.meta?.commitMessage === "string" ? e.node.meta.commitMessage : null,
  }));
}

/** One-shot read-only probe: the last `limit` deployments for this service. */
export async function probeRailwayStatus(limit = 5): Promise<RailwayStatus> {
  const env = readRailwayEnv();
  if (!env) return { configured: false };

  const res = await railwayGraphQL<RailwayDeploymentsResponse>(
    env.token,
    "query($input: DeploymentListInput!) { deployments(input: $input, first: " +
      limit +
      ") { edges { node { status createdAt meta } } } }",
    { input: { projectId: env.projectId, environmentId: env.environmentId, serviceId: env.serviceId } }
  );
  if (!res.ok) return { configured: true, ok: false, error: res.error };
  return { configured: true, ok: true, deployments: mapDeploymentEdges(res.data.deployments?.edges) };
}

// --- Resource usage (CPU / memory) ------------------------------------------

export type RailwayResourceUsage =
  | { configured: false }
  | { configured: true; ok: false; error: string }
  | {
      configured: true;
      ok: true;
      window_minutes: number;
      cpu_avg_vcpu: number | null;
      cpu_latest_vcpu: number | null;
      memory_avg_gb: number | null;
      memory_latest_gb: number | null;
    };

type RailwayMetricPoint = { ts: number; value: number };
type RailwayMetricSeries = { measurement: string; values: RailwayMetricPoint[] };
type RailwayMetricsResponse = { metrics?: RailwayMetricSeries[] };

/** Pure: average + latest value for CPU/memory from the raw metrics series.
 *  A measurement that comes back empty (or absent) maps to null, never a
 *  fabricated 0 — "no data in this window" and "genuinely idle" must stay
 *  distinguishable. */
export function summarizeResourceMetrics(series: RailwayMetricSeries[] | undefined): {
  cpu_avg_vcpu: number | null;
  cpu_latest_vcpu: number | null;
  memory_avg_gb: number | null;
  memory_latest_gb: number | null;
} {
  const cpu = series?.find((s) => s.measurement === "CPU_USAGE")?.values ?? [];
  const mem = series?.find((s) => s.measurement === "MEMORY_USAGE_GB")?.values ?? [];
  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  const avg = (vals: RailwayMetricPoint[]) =>
    vals.length ? round3(vals.reduce((sum, v) => sum + v.value, 0) / vals.length) : null;
  const latest = (vals: RailwayMetricPoint[]) => (vals.length ? round3(vals[vals.length - 1].value) : null);
  return { cpu_avg_vcpu: avg(cpu), cpu_latest_vcpu: latest(cpu), memory_avg_gb: avg(mem), memory_latest_gb: latest(mem) };
}

/** One-shot read-only probe: CPU (vCPU) + memory (GB) usage over the last `windowMinutes`. */
export async function probeRailwayResourceUsage(windowMinutes = 60): Promise<RailwayResourceUsage> {
  const env = readRailwayEnv();
  if (!env) return { configured: false };

  const startDate = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const res = await railwayGraphQL<RailwayMetricsResponse>(
    env.token,
    "query($startDate: DateTime!, $projectId: String, $environmentId: String, $serviceId: String) { metrics(startDate: $startDate, measurements: [CPU_USAGE, MEMORY_USAGE_GB], projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId, sampleRateSeconds: 1800) { measurement values { ts value } } }",
    { startDate, projectId: env.projectId, environmentId: env.environmentId, serviceId: env.serviceId }
  );
  if (!res.ok) return { configured: true, ok: false, error: res.error };
  return { configured: true, ok: true, window_minutes: windowMinutes, ...summarizeResourceMetrics(res.data.metrics) };
}

// --- Env-var presence audit (never values) ----------------------------------

export type RailwayEnvVarAudit =
  | { configured: false }
  | { configured: true; ok: false; error: string }
  | { configured: true; ok: true; total_count: number; missing_critical: string[] };

/** Vars this app cannot run correctly without. Presence-only check — never
 *  reads or reports a value, only whether the key exists. Kept in sync by
 *  hand; add a new entry here if a hard-required provider key is added. */
export const CRITICAL_ENV_VARS = [
  "DATABASE_URL",
  "REDIS_URL",
  "ANTHROPIC_API_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SECRET",
  "POLYGON_API_KEY",
  "UW_API_KEY",
  "CRON_SECRET",
  "WHOP_API_KEY",
  "WHOP_WEBHOOK_SECRET",
] as const;

/** Pure: which critical vars are missing from a list of SET key names. Takes
 *  key names only — callers must never pass actual values in here. */
export function auditEnvVarKeys(
  keys: string[],
  critical: readonly string[] = CRITICAL_ENV_VARS
): { total_count: number; missing_critical: string[] } {
  const set = new Set(keys);
  return { total_count: keys.length, missing_critical: critical.filter((k) => !set.has(k)) };
}

/** One-shot read-only probe: how many env vars are set, and which of the
 *  hard-required ones (if any) are missing. Never returns a value — the raw
 *  key→value payload Railway returns is discarded the instant key names are
 *  extracted, on the next line, and touched nowhere else in this function. */
export async function probeRailwayEnvVars(): Promise<RailwayEnvVarAudit> {
  const env = readRailwayEnv();
  if (!env) return { configured: false };

  const res = await railwayGraphQL<{ variables?: Record<string, unknown> }>(
    env.token,
    "query($projectId: String!, $environmentId: String!, $serviceId: String) { variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) }",
    { projectId: env.projectId, environmentId: env.environmentId, serviceId: env.serviceId }
  );
  if (!res.ok) return { configured: true, ok: false, error: res.error };
  const keys = Object.keys(res.data.variables ?? {});
  return { configured: true, ok: true, ...auditEnvVarKeys(keys) };
}

// --- Recent runtime error count ---------------------------------------------

export type RailwayRuntimeErrors =
  | { configured: false }
  | { configured: true; ok: false; error: string }
  | {
      configured: true;
      ok: true;
      window_minutes: number;
      error_count: number;
      error_count_capped: boolean;
      sample_messages: string[];
    };

type RailwayLiveDeploymentEdge = { node: { id: string; status: string } };
type RailwayLiveDeploymentsResponse = { deployments?: { edges?: RailwayLiveDeploymentEdge[] } };

const RUNTIME_ERROR_LOG_LIMIT = 200;

/** Pure: pick the deployment actually serving traffic from a newest-first list.
 *  The newest entry isn't always live (it can be BUILDING, or a stuck deploy —
 *  see the 2026-07-03 Railway status-reporting stall in FINDINGS.md) and older
 *  SUCCESS deployments get REMOVED once replaced, so "first SUCCESS" is the
 *  correct pick, not "first entry." */
export function pickLiveDeploymentId(edges: RailwayLiveDeploymentEdge[] | undefined): string | null {
  const live = edges?.find((e) => e.node.status === "SUCCESS");
  return live ? live.node.id : null;
}

/** One-shot read-only probe: error-severity runtime log lines from the currently
 *  live deployment over the last `windowMinutes`. Deliberately manual-only
 *  until now (a larger surface than deploy status) — this is the first
 *  automated read of runtime logs, not just deploy metadata. */
export async function probeRailwayRuntimeErrors(windowMinutes = 30, sampleLimit = 5): Promise<RailwayRuntimeErrors> {
  const env = readRailwayEnv();
  if (!env) return { configured: false };

  const deploymentsRes = await railwayGraphQL<RailwayLiveDeploymentsResponse>(
    env.token,
    "query($input: DeploymentListInput!) { deployments(input: $input, first: 5) { edges { node { id status } } } }",
    { input: { projectId: env.projectId, environmentId: env.environmentId, serviceId: env.serviceId } }
  );
  if (!deploymentsRes.ok) return { configured: true, ok: false, error: deploymentsRes.error };
  const deploymentId = pickLiveDeploymentId(deploymentsRes.data.deployments?.edges);
  if (!deploymentId) return { configured: true, ok: false, error: "no SUCCESS deployment found in recent history" };

  const startDate = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const logsRes = await railwayGraphQL<{ deploymentLogs?: Array<{ message: string }> }>(
    env.token,
    'query($id: String!, $startDate: DateTime, $limit: Int) { deploymentLogs(deploymentId: $id, filter: "@level:error", startDate: $startDate, limit: $limit) { message } }',
    { id: deploymentId, startDate, limit: RUNTIME_ERROR_LOG_LIMIT }
  );
  if (!logsRes.ok) return { configured: true, ok: false, error: logsRes.error };
  const logs = logsRes.data.deploymentLogs ?? [];
  return {
    configured: true,
    ok: true,
    window_minutes: windowMinutes,
    error_count: logs.length,
    error_count_capped: logs.length >= RUNTIME_ERROR_LOG_LIMIT,
    sample_messages: logs.slice(0, sampleLimit).map((l) => l.message.slice(0, 300)),
  };
}
