import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { processDueWelcomeSequenceSteps } from "@/lib/welcome-sequence";
import { logCronRun } from "@/lib/cron-run";
import { tryAdvisoryLock, releaseAdvisoryLock } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const WELCOME_SEQUENCE_LOCK = "welcome-sequence-send";

/**
 * Sends whichever step of the 5-email member welcome drip is next due
 * (docs/marketing/SEO-GROWTH.md — Content & Copy). Step 1 sends immediately
 * from the Clerk user.created webhook (src/lib/welcome-sequence.ts's
 * startWelcomeSequence); this cron handles steps 2-5, 2 days apart, by
 * scanning welcome_sequence_state for rows whose next_send_at has passed.
 * Safe to run frequently — a row with no due step is simply not selected.
 */
export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const acquired = await tryAdvisoryLock(WELCOME_SEQUENCE_LOCK);
  if (!acquired) {
    const payload = { ok: true, skipped: true, reason: "locked" };
    await logCronRun("welcome-sequence", started, payload);
    return NextResponse.json(payload);
  }

  try {
    const result = await processDueWelcomeSequenceSteps();
    await logCronRun("welcome-sequence", started, { ok: true, ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/welcome-sequence]", error);
    await logCronRun("welcome-sequence", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "Welcome sequence send failed" }, { status: 500 });
  } finally {
    await releaseAdvisoryLock(WELCOME_SEQUENCE_LOCK);
  }
}
