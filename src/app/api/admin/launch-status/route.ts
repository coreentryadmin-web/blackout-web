import { NextResponse } from "next/server";
import { resolveAdminApi } from "@/lib/admin-access";
import { logAdminAction } from "@/lib/admin-audit";
import { getLaunchStatusSnapshot } from "@/lib/tool-access";

export const dynamic = "force-dynamic";

/** Admin-only readout of LAUNCHED_TOOLS / premium launch gate (same as /admin panel). */
export async function GET() {
  const { actor, denied } = await resolveAdminApi();
  if (denied) return denied;

  void logAdminAction({
    actorUserId: actor?.userId,
    actorEmail: actor?.email,
    action: "admin_view",
    detail: { path: "admin/launch-status" },
  });

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    ...getLaunchStatusSnapshot(),
  });
}
