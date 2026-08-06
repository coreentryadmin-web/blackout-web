// Cron: ENGINE B live-sync — mark-and-manage every OPEN/PARTIAL banger position.
//
// SCHEDULE (blackout-infra follow-up — see PR description): piggyback on an EXISTING frequent cron
// cadence rather than requesting new EventBridge wiring. `zerodte-warm`/`desk-warm` fire every ~2-5 min
// during market hours — that cadence (not swing-active-refresh's 15-min) matches the scale-out rule's
// need to catch a 2x touch/hard-stop reasonably promptly. Until blackout-infra wiring exists, this route
// can be fired manually or folded into an existing ~5-min cron's handler.
//
// Kill-switch is checked INSIDE runBangerLiveSync (flag.ts) — a disabled engine leaves every open
// position exactly as-is (marks simply stop refreshing; nothing is force-closed by turning this off).

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { runBangerLiveSync } from "@/lib/banger/live-sync";
import { fetchOpenBangerPositions, updateBangerLiveState } from "@/lib/banger/positions-db";
import { fetchOptionsUnifiedSnapshot } from "@/lib/providers/options-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runBangerLiveSync({
      fetchOpenPositions: async () => {
        const rows = await fetchOpenBangerPositions();
        return rows.map((r) => ({
          id: r.id,
          ticker: r.ticker,
          contract_occ: r.contract_occ,
          entry_premium: r.entry_premium,
          peak_premium: r.peak_premium,
          scaled_already: r.scaled_already,
          partial_realized_premium: r.partial_realized_premium,
          status: r.status,
        }));
      },
      fetchMarks: async (occs) => {
        const snaps = await fetchOptionsUnifiedSnapshot(occs);
        const marks = new Map<string, number>();
        for (const [occ, snap] of snaps) {
          if (typeof snap.mark === "number" && Number.isFinite(snap.mark) && snap.mark > 0) {
            marks.set(occ, snap.mark);
          }
        }
        return marks;
      },
      updateLiveState: updateBangerLiveState,
    });
    await logCronRun("banger-live-sync", started, { ...result, duration_ms: Date.now() - started });
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/banger-live-sync]", error);
    await logCronRun("banger-live-sync", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "Banger live-sync failed" }, { status: 500 });
  }
}
