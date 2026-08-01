import { NextResponse } from "next/server";
import { resolveAdminApi } from "@/lib/admin-access";
import { buildAdminHealthSnapshot } from "@/lib/admin-health";
import { maybeAlertCriticalIssues } from "@/lib/admin-critical-alerts";
import { logAdminAction } from "@/lib/admin-audit";
import { recordAdminRouteError } from "@/lib/admin-route-errors";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";

export const dynamic = "force-dynamic";

export async function GET() {
  // Single resolve: one getUser for both the gate and the read-audit actor.
  const { actor, denied } = await resolveAdminApi();
  if (denied) return denied;

  // Audit admin READ access to this sensitive dashboard (fire-and-forget).
  void logAdminAction({
    actorUserId: actor?.userId,
    actorEmail: actor?.email,
    action: "admin_view",
    detail: { path: "admin/health" },
  });

  try {
    const health = await buildAdminHealthSnapshot();
    await maybeAlertCriticalIssues(health.issues);
    return NextResponse.json(health, { headers: NO_STORE_HEADERS });
  } catch (error) {
    recordAdminRouteError("admin/health", error);
    return NextResponse.json(
      { error: "Failed to load admin health" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }
}
