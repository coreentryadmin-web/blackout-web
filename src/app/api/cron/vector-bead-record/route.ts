// Cron + observability backup for the in-process 5s bead recorder (vector-bead-recorder-leader.ts).
// EventBridge floor is 1/min — the leader is the primary writer; this route logs heartbeat +
// re-records when the leader is down.

import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { isEtCashRth } from "@/lib/et-market-hours";
import { recordSharedUniverseWallSamples } from "@/features/vector/lib/vector-bead-recorder-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && !isEtCashRth()) {
    const payload = { ok: true, skipped: true, reason: "Outside cash RTH" };
    await logCronRun("vector-bead-record", started, payload);
    return NextResponse.json(payload);
  }

  const run = async () => {
    try {
      const result = await recordSharedUniverseWallSamples();
      await logCronRun("vector-bead-record", started, {
        ok: result.recorded > 0,
        ...result,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[cron/vector-bead-record] REJECTED: ${detail}`);
      await logCronRun("vector-bead-record", started, { ok: false, error: detail });
    }
  };

  try {
    after(() => {
      void run();
    });
  } catch {
    void run();
  }

  return NextResponse.json(
    {
      ok: true,
      status: "accepted",
      reason: "Vector bead recorder dispatched in background",
      note: "Primary 5s cadence is in-process vector-bead-recorder-leader; this cron is backup + audit.",
    },
    { status: 202 }
  );
}
