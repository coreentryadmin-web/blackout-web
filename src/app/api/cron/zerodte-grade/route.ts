// Cron: dedicated 0DTE ledger grading — runs gradeZeroDteLedger directly without
// relying on the lazy 10-minute throttle inside warmZeroDteBoard. Callable every
// 15 minutes during the 16:30-20:00 ET post-close window so all session plays are
// graded promptly after the close, independent of the warm cron's own cadence.
//
// Motivation (CTO audit): grading was piggybacked inside warmZeroDteBoard with a
// 10-minute throttle, which meant (a) grading could be starved if the warm itself
// was slow, (b) there was no way to trigger grading independently, and (c) post-
// close grading depended on the warm cron still firing after the scanner's own ET
// window. This standalone route decouples the two concerns.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { gradeZeroDteLedger } from "@/lib/zerodte/scan";
import { refreshShadowRailPriors } from "@/lib/zerodte/calibration-rail-priors";
import { refreshRailGraduation } from "@/lib/zerodte/calibration-rail-graduation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // force=true bypasses the 10-minute internal throttle so this cron always
    // grades on its own schedule, never skipped because warmZeroDteBoard ran
    // recently.
    const graded = await gradeZeroDteLedger(/* force */ true);
    const [shadowPriors, graduation] = await Promise.all([
      refreshShadowRailPriors().catch(() => null),
      refreshRailGraduation().catch(() => null),
    ]);
    const payload = {
      ok: true,
      graded,
      shadow_priors_refreshed: shadowPriors != null,
      rail_graduation_refreshed: graduation != null,
      any_rail_ready: graduation?.any_rail_ready ?? false,
    };
    await logCronRun("zerodte-grade", started, payload);
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/zerodte-grade] grading failed:", message);
    await logCronRun("zerodte-grade", started, { ok: false, error: message });
    return NextResponse.json({ ok: false, error: "0DTE grading failed" }, { status: 500 });
  }
}
