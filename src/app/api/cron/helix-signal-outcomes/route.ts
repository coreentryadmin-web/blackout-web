import { NextRequest, NextResponse } from "next/server";
import { isEtExtendedWarmHours } from "@/lib/et-market-hours";
import { requireDatabaseInProduction, tryAdvisoryLock, releaseAdvisoryLock } from "@/lib/db";
import { recordHelixSignalFirings, gradeHelixSignalOutcomes } from "@/lib/helix-signal-outcomes-job";
import { logCronRun } from "@/lib/cron-run";
import { isCronAuthorized } from "@/lib/market-api-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HELIX_SIGNAL_OUTCOMES_LOCK = "helix-signal-outcomes";

/**
 * Helix Tier 2 (item #9, 2026-08-02 audit): persists velocity-spike/split-flow firings and
 * grades their outcome. Async/best-effort, off the member-facing /flows request path
 * (user-confirmed design 2026-08-02) — see src/lib/helix-signal-outcomes-job.ts for the
 * record()/grade() split and the full root-cause writeup.
 */
export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbDenied = requireDatabaseInProduction();
  if (dbDenied) return dbDenied;

  // Registered `market_hours_only: true` — grading firings against minute bars only matters during
  // cash session, but `gradeHelixSignalOutcomes`'s 1h checkpoint for a firing near the close needs
  // to run PAST 16:00 ET to catch it promptly (deployed schedule `*/15 13-21 * * 1-5` UTC is 9:00-
  // 17:00 ET under EDT specifically to cover this). Using isEtCashRth's hard 16:00 cutoff here would
  // remove that margin and delay last-hour checkpoints ~17h to the next session's first fire (PR
  // #4484 review). isEtExtendedWarmHours (4:00-20:00 ET) still closes the weekday-holiday gap this
  // PR targets while preserving the post-close grading window.
  if (!isEtExtendedWarmHours()) {
    const payload = { ok: true, skipped: true, reason: "outside extended hours (weekend/holiday/overnight)" };
    await logCronRun("helix-signal-outcomes", started, payload);
    return NextResponse.json(payload);
  }

  const acquired = await tryAdvisoryLock(HELIX_SIGNAL_OUTCOMES_LOCK);
  if (!acquired) {
    const payload = { ok: true, skipped: true, reason: "locked" };
    await logCronRun("helix-signal-outcomes", started, payload);
    return NextResponse.json(payload);
  }

  try {
    const recordResult = await recordHelixSignalFirings();
    const gradeResult = await gradeHelixSignalOutcomes();
    const payload = { ok: true, ...recordResult, ...gradeResult };
    await logCronRun("helix-signal-outcomes", started, payload);
    return NextResponse.json(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/helix-signal-outcomes]", error);
    await logCronRun("helix-signal-outcomes", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "Helix signal outcomes job failed" }, { status: 500 });
  } finally {
    await releaseAdvisoryLock(HELIX_SIGNAL_OUTCOMES_LOCK);
  }
}
