import { NextRequest, NextResponse } from "next/server";
import { resolveAdminApi } from "@/lib/admin-access";
import { fetchSpxAdminDashboard } from "@/lib/admin-spx-dashboard";
import { logAdminAction } from "@/lib/admin-audit";
import { recordAdminRouteError } from "@/lib/admin-route-errors";

export const dynamic = "force-dynamic";

// GET is strictly read-only: ?live=1 runs the engine's dry-run snapshot, but the
// mutating path (real BUY/SELL state writes + live subscriber Discord alerts) is
// POST-only below. Previously GET ?live=1&dryRun=false performed the mutation —
// CSRF-shaped (a GET a browser can be steered into) and it bypassed the
// POST-only-mutation convention the rest of the app follows (audit MEDIUM).
export async function GET(req: NextRequest) {
  // Single resolve: one getUser for both the gate and the audit actor.
  const { actor, denied } = await resolveAdminApi();
  if (denied) return denied;

  const live = req.nextUrl.searchParams.get("live") === "1";
  if (req.nextUrl.searchParams.get("dryRun") === "false") {
    return NextResponse.json(
      { error: "Live-engine mutation moved to POST. GET is read-only (dry-run)." },
      { status: 405, headers: { Allow: "GET, POST" } }
    );
  }

  try {
    const dashboard = await fetchSpxAdminDashboard({ liveEngine: live, dryRun: true });
    if (live) {
      try {
        await logAdminAction({
          actorUserId: actor?.userId,
          actorEmail: actor?.email,
          action: "spx_live_engine",
          detail: {
            play_action: dashboard.play?.action ?? null,
            direction: dashboard.play?.direction ?? null,
            dry_run: true,
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

// POST: the ONLY path that runs the live engine with real mutations (engine state
// writes, Discord alerts). Requires an explicit JSON body {confirm: "live-run"} —
// the server-verified confirmation the client's double-confirm dialog produces.
// JSON body + same-origin Clerk session also gives CSRF protection: a cross-site
// form can't set application/json without a CORS preflight this route never allows.
export async function POST(req: NextRequest) {
  const { actor, denied } = await resolveAdminApi();
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as { confirm?: string } | null;
  if (body?.confirm !== "live-run") {
    return NextResponse.json(
      { error: "Missing confirmation. Send {\"confirm\":\"live-run\"} to run the live engine." },
      { status: 400 }
    );
  }

  try {
    const dashboard = await fetchSpxAdminDashboard({ liveEngine: true, dryRun: false });
    try {
      await logAdminAction({
        actorUserId: actor?.userId,
        actorEmail: actor?.email,
        action: "spx_live_engine",
        detail: {
          play_action: dashboard.play?.action ?? null,
          direction: dashboard.play?.direction ?? null,
          dry_run: false,
        },
      });
    } catch (e) {
      console.error('[admin-spx] audit log failed:', e);
    }
    return NextResponse.json(dashboard);
  } catch (error) {
    recordAdminRouteError("admin/spx/dashboard", error);
    return NextResponse.json({ error: "Failed to run live engine" }, { status: 502 });
  }
}
