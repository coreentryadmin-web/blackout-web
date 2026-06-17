import { NextResponse } from "next/server";
import { deskFlowCacheTtlMs } from "@/lib/providers/config";
import { buildSpxDeskFlow, getLastPulseForSignals } from "@/lib/providers/spx-desk";
import { maybeLogSpxSignal } from "@/lib/providers/spx-signal-log";
import { buildDeskFromPulseFlow } from "@/lib/spx-desk-merge";
import { withServerCache } from "@/lib/server-cache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const flow = await withServerCache("spx-desk-flow", deskFlowCacheTtlMs(), buildSpxDeskFlow, {
      staleWhileRevalidate: false,
    });

    const pulse = getLastPulseForSignals();
    if (pulse && flow.available) {
      void maybeLogSpxSignal(buildDeskFromPulseFlow(pulse, flow)).catch((err) =>
        console.error("[market/spx/flow] signal log", err)
      );
    }

    return NextResponse.json(flow, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    console.error("[market/spx/flow]", error);
    return NextResponse.json({ available: false, error: "Flow build failed" }, { status: 502 });
  }
}
