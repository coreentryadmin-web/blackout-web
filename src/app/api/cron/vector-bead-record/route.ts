// Cron + observability backup for the in-process 5s bead recorder (vector-bead-recorder-leader.ts).
// EventBridge floor is 1/min — the leader is the primary writer; this route logs heartbeat +
// re-records when the leader is down.

import { NextRequest, NextResponse, after } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { isEtCashRth } from "@/lib/et-market-hours";
import { recordSharedUniverseWallSamples, recordActiveNonUniverseWallSamples } from "@/features/vector/lib/vector-bead-recorder-core";

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

  // Universe + active-viewer bead sweeps can exceed Cloudflare's ~100s origin timeout when caches
  // are cold (ops #1783: market_hours_stale with no fresh cron_job_runs row). Mirror
  // vector-full-state-snapshot / coaching-alerts: handshake in seconds, recording in after().
  const dispatchRecording = () => {
    void (async () => {
      try {
        const [universe, active] = await Promise.all([
          recordSharedUniverseWallSamples(),
          recordActiveNonUniverseWallSamples(),
        ]);
        console.info(
          `[cron/vector-bead-record] background done — universe=${universe.recorded}/${universe.total} active=${active.recorded}/${active.total} elapsed=${Date.now() - started}ms`
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[cron/vector-bead-record] background REJECTED: ${detail}`);
      }
    })();
  };

  try {
    after(dispatchRecording);
  } catch {
    dispatchRecording();
  }

  const accepted = {
    ok: true,
    status: "accepted",
    reason: "Vector bead recorder dispatched in background",
  };
  await logCronRun("vector-bead-record", started, accepted);
  return NextResponse.json(
    {
      ...accepted,
      note: "Primary 5s cadence is in-process vector-bead-recorder-leader; HTTP cron is backup + audit — handshake stays under edge timeout.",
    },
    { status: 202 }
  );
}
