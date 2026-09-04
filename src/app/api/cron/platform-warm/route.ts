// Cron: pre-warm general platform caches available 24/7.
// Schedule: every 5 minutes, 24 hours/day.
//
// THE POINT: The platform bootstrap bundle (loaded by many admin/member pages outside market
// hours) is UW-bound (~2–5s cold). This cron keeps the bootstrap cache warm so off-hours
// page loads (night Hawk edge, early BIE lookups) don't block on expensive rebuilds.

import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { loadBootstrapBundle } from "@/features/spx/lib/spx-desk-loader";
import { runWithBackgroundUwSweep } from "@/lib/providers/uw-rate-limiter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function runPlatformWarm(started: number): Promise<void> {
  const bootstrapResult = await Promise.allSettled([loadBootstrapBundle()]);
  const bootstrapOk = bootstrapResult[0].status === "fulfilled";
  if (!bootstrapOk) {
    console.warn(
      "[cron/platform-warm] background loadBootstrapBundle failed:",
      bootstrapResult[0].status === "rejected" ? bootstrapResult[0].reason : "unknown"
    );
  } else {
    console.info(`[cron/platform-warm] background done — elapsed=${Date.now() - started}ms`);
  }
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dispatchWarm = () => {
    void runWithBackgroundUwSweep(() => runPlatformWarm(started)).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[cron/platform-warm] background warm REJECTED: ${detail}`);
    });
  };

  try {
    after(dispatchWarm);
  } catch {
    dispatchWarm();
  }

  const accepted = {
    ok: true,
    status: "accepted",
    reason: "platform bootstrap warm dispatched in background (fire-and-forget)",
  };
  await logCronRun("platform-warm", started, accepted);
  return NextResponse.json(
    {
      ...accepted,
      note: "Bootstrap bundle rebuild runs in background — handshake stays under edge timeout.",
    },
    { status: 202 }
  );
}
