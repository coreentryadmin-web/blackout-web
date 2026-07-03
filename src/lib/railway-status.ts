// BLACKOUT Intelligence Engine — Layer 3 diagnostic Railway deploy-status probe.
// Read-only: reports this service's recent deployments (status/commit/timestamp)
// via the Railway GraphQL API. Never mutates anything — no redeploy, no env var
// reads/writes, no logs (a separate, larger surface deliberately left for later).
// Railway auto-injects RAILWAY_PROJECT_ID/RAILWAY_ENVIRONMENT_ID/RAILWAY_SERVICE_ID
// into every deployment's own runtime, so the only new configuration this needs is
// RAILWAY_TOKEN (a project-scoped Project-Access-Token) as a real service env var.

const RAILWAY_GRAPHQL_URL = "https://backboard.railway.com/graphql/v2";

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
  data?: { deployments?: { edges?: RailwayDeploymentEdge[] } };
  errors?: Array<{ message?: string }>;
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
  const token = process.env.RAILWAY_TOKEN?.trim();
  const projectId = process.env.RAILWAY_PROJECT_ID?.trim();
  const environmentId = process.env.RAILWAY_ENVIRONMENT_ID?.trim();
  const serviceId = process.env.RAILWAY_SERVICE_ID?.trim();
  if (!token || !projectId || !environmentId || !serviceId) return { configured: false };

  try {
    const res = await fetch(RAILWAY_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Project-Access-Token": token },
      body: JSON.stringify({
        query:
          "query($input: DeploymentListInput!) { deployments(input: $input, first: " +
          limit +
          ") { edges { node { status createdAt meta } } } }",
        variables: { input: { projectId, environmentId, serviceId } },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { configured: true, ok: false, error: `Railway API HTTP ${res.status}` };
    const json = (await res.json()) as RailwayDeploymentsResponse;
    if (json.errors?.length) {
      return { configured: true, ok: false, error: json.errors[0]?.message ?? "Railway GraphQL error" };
    }
    return { configured: true, ok: true, deployments: mapDeploymentEdges(json.data?.deployments?.edges) };
  } catch (e) {
    return { configured: true, ok: false, error: e instanceof Error ? e.message : "Railway probe failed" };
  }
}
