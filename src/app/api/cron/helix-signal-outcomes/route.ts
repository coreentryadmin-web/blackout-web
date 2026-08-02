import { NextRequest, NextResponse } from "next/server";
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
