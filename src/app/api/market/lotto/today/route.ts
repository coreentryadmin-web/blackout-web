import { NextResponse } from "next/server";
import { deskCacheTtlMs, deskFlowCacheTtlMs, deskPulseCacheTtlMs } from "@/lib/providers/config";
import {
  buildSpxDesk,
  buildSpxDeskFlow,
  buildSpxDeskPulse,
} from "@/lib/providers/spx-desk";
import { mergeFlowIntoDesk, mergePulseIntoDesk } from "@/lib/spx-desk-merge";
import { withServerCache } from "@/lib/server-cache";
import { evaluateSpxLotto } from "@/lib/spx-lotto-engine";
import { buildPlayTechnicals } from "@/lib/spx-play-technicals";
import { fetchLottoPlaysForDate } from "@/lib/db";

export const dynamic = "force-dynamic";

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

export async function GET() {
  try {
    const [desk, flow, pulse] = await Promise.all([
      withServerCache("spx-desk", deskCacheTtlMs(), buildSpxDesk, {
        staleWhileRevalidate: false,
      }),
      withServerCache("spx-desk-flow", deskFlowCacheTtlMs(), buildSpxDeskFlow, {
        staleWhileRevalidate: false,
      }),
      withServerCache("spx-desk-pulse", deskPulseCacheTtlMs(), buildSpxDeskPulse, {
        staleWhileRevalidate: false,
      }),
    ]);

    let merged = desk;
    if (flow?.available) merged = mergeFlowIntoDesk(merged, flow);
    if (pulse) {
      if (pulse.available) merged = mergePulseIntoDesk(merged, pulse);
      else {
        merged = {
          ...merged,
          market_open: pulse.market_open,
          market_status: pulse.market_status,
          market_label: pulse.market_label,
          polled_at: pulse.polled_at,
        };
      }
    }

    const technicals = await buildPlayTechnicals(merged.price, {
      vwap: merged.vwap,
      pdh: merged.pdh,
      pdl: merged.pdl,
      hod: merged.hod,
      lod: merged.lod,
    });

    const lotto = await evaluateSpxLotto(merged, technicals);
    const history = await fetchLottoPlaysForDate(todayEt());

    return NextResponse.json(
      {
        available: true,
        as_of: merged.polled_at ?? new Date().toISOString(),
        lotto,
        history,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
        },
      }
    );
  } catch (error) {
    console.error("[market/lotto/today]", error);
    return NextResponse.json(
      { available: false, lotto: null, error: "Lotto engine failed" },
      { status: 502 }
    );
  }
}
