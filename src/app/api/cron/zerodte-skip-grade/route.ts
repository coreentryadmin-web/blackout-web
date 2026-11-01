// Cron: 0DTE counterfactual SKIP grading (src/lib/zerodte/skip-grading.ts's runSkipGrading).
//
// WHY THIS CRON EXISTS: runSkipGrading is the ONLY instrument that answers "did gate X block a
// winner" — it replays a blocked setup's underlying move under the same plan rules a committed
// play grades under. Before this route, the ONLY caller was the admin `POST
// /api/market/zerodte/calibration?grade_skips=1` route — a manual, on-demand action nobody was
// actually invoking. The 2026-09-12 session_date/timezone fix (see skip-grading.ts's own long
// comment on the bug) corrected the grading LOGIC, but with no scheduled caller the fix never
// actually ran against the live backlog: found live 2026-09-15 that every gate's blocked_value
// in the calibration report still read n=0/all-ungradeable on a fresh GET, exactly the pre-fix
// signature, simply because nothing had invoked the grader since the fix landed. A single manual
// POST immediately after (bounded, idempotent — only fills NULL cells) graded 170/200 previously
// stuck rows. Without a cron, every future day's rejections silently pile back up the same way.
//
// Runs once daily, post-close (after the 16:00 ET session settles so the day's own rejections
// have real minute bars to grade against). Bounded to MAX_SKIP_GRADE_DAYS/MAX_ROWS_PER_RUN per
// run (skip-grading.ts's own constants) — idempotent (only fills NULL counterfactual_json cells),
// so a missed or re-run day is harmless.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { todayEt } from "@/lib/et-date";
import { isTradingDayEt } from "@/features/nighthawk/lib/session";
import { runSkipGrading } from "@/lib/zerodte/skip-grading";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  const sessionDay = todayEt(new Date(started));

  // Holiday guard, same idiom as zerodte-grade: no point re-scanning a closed-tape day, and
  // running on a holiday would either find nothing or (worse) try to grade against a tape that
  // never opened.
  if (!force && !isTradingDayEt(sessionDay)) {
    const payload = { ok: true, skipped: true, reason: `non-trading day (${sessionDay})` };
    await logCronRun("zerodte-skip-grade", started, payload);
    return NextResponse.json(payload);
  }

  try {
    const summary = await runSkipGrading({ nowMs: started });
    const payload = { ok: true, ...summary };
    await logCronRun("zerodte-skip-grade", started, payload);
    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/zerodte-skip-grade] grading failed:", message);
    await logCronRun("zerodte-skip-grade", started, { ok: false, error: message });
    return NextResponse.json({ ok: false, error: "0DTE skip grading failed" }, { status: 500 });
  }
}
