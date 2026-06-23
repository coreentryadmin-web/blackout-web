import { NextRequest, NextResponse } from "next/server";
import { resolveAdminApi } from "@/lib/admin-access";
import { fetchSpxAdminDashboard } from "@/lib/admin-spx-dashboard";
import { logAdminAction } from "@/lib/admin-audit";
import { recordAdminRouteError } from "@/lib/admin-route-errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Single resolve: one getUser for both the gate and the audit actor.
  const { actor, denied } = await resolveAdminApi();
  if (denied) return denied;

  const live = req.nextUrl.searchParams.get("live") === "1";
  // EDGE-10: dryRun defaults to true. Only pass dryRun=false when the client
  // has performed a second explicit confirmation to allow real mutations.
  const dryRun = req.nextUrl.searchParams.get("dryRun") !== "false";

  try {
    const dashboard = await fetchSpxAdminDashboard({ liveEngine: live, dryRun });
    if (live) {
      try {
        await logAdminAction({
          actorUserId: actor?.userId,
          actorEmail: actor?.email,
          action: "spx_live_engine",
          detail: {
            play_action: dashboard.play?.action ?? null,
            direction: dashboard.play?.direction ?? null,
            dry_run: dryRun,
          },
        });
      } catch (e) {
        console.error('[admin-spx] audit log failed:', e);
      }
    }
    return NextResponse.json(dashboard);
  } catch (error) {
    recordAdminRouteError("admin/spx/dashboard", error);
    return NextResponse.json({ error: "Failed to load SPX dashboard" }, { status: 502 });
  }
}
