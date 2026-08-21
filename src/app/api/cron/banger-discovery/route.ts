// Cron: ENGINE B whole-market discovery-and-commit — one pass per session day.
//
// WHY a NEW route rather than piggybacking on swing-discovery/zerodte-warm's HANDLER: those routes'
// bodies are already deeply wired to their own engines' deps (swing accumulation memory, 0DTE scan
// cadence). A separate thin route keeps Engine B's kill-switch + wiring isolated and auditable, while
// still reusing swing-discovery's IDEMPOTENCY PATTERN below (a same-day re-fire is a no-op).
//
// SCHEDULE — TWO UTC HOURS, BECAUSE EVENTBRIDGE HAS NO TIMEZONE. This route wants ONE fire per session
// day shortly AFTER the close. The original wiring was `15 20 * * 1-5`, and the header here used to state
// the equivalence "~4:15pm ET / 20:15 UTC" as if it were fixed. It is not: `aws_cloudwatch_event_rule`
// fires on a FIXED UTC clock (classic Rules have no timezone support at all), while the close is an ET
// wall-clock event that moves with daylight saving.
//
//   EDT (UTC-4):  20:15 UTC -> 16:15 ET   post-close, correct
//   EST (UTC-5):  20:15 UTC -> 15:15 ET   FORTY-FIVE MINUTES BEFORE THE CLOSE
//
// Under EST that single fire screened an UNSETTLED grouped-daily tape — gain%, volume and close-strength
// on a session still in progress — and COMMITTED positions from it, then claimed the day idempotently so
// nothing ever corrected it. It did not fail, log, or alert: a partial session looks exactly like a
// finished one to `screenBangerMovers`. That is roughly Nov 1 -> Mar 8 of silently wrong entries.
//
// The fix is the pattern `nighthawk-morning-confirm` and `nighthawk-outcomes` already use: schedule TWO
// adjacent UTC hours so one of them lands in the ET window in EITHER offset, and let a DST-aware guard
// self-skip the off-band fire. Schedule is `15 20,21 * * 1-5` (see railway.banger-discovery.toml, which
// is the generator input blackout-infra's sync-cron-schedules.mjs reads).
//
//   EDT:  20:15 -> 16:15 ET  RUN  ·  21:15 -> 17:15 ET  (idempotent no-op, day already claimed)
//   EST:  20:15 -> 15:15 ET  SKIP ·  21:15 -> 16:15 ET  RUN
//
// THE GUARD MUST RUN BEFORE THE CLAIM. A pre-close fire that self-skips must NOT consume the day's
// idempotency claim — if it did, the good post-close fire an hour later would be rejected as "already
// ran" and EST would go from wrong-data to no-data.
//
// IDEMPOTENT PER (date): a redis marker is claimed before running (mirrors swing-discovery's atomic
// SET NX pattern) so a re-fire the same day is a no-op unless `?force=1`. Kill-switch is checked INSIDE
// runBangerCommit (flag.ts) — this route still claims the day (so re-enabling and re-firing 20 minutes
// later on the same day is also correctly idempotent) but the commit does nothing when disabled.

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { sharedCacheDel, sharedCacheSetNx } from "@/lib/shared-cache";
import { todayEt } from "@/lib/et-date";
// Shared, pure, Intl-based ET window check — deliberately reused rather than reimplemented. It lives in
// an alias-free file precisely so non-nighthawk callers can use it without dragging in that feature's
// import chain, and it takes an injectable `now` so the guard is testable at fixed EST/EDT instants.
import { inEtWindow } from "@/features/nighthawk/lib/et-window";
import { runBangerCommit } from "@/lib/banger/commit";
import { insertBangerPosition } from "@/lib/banger/positions-db";
import { fetchDailyMarketSummary } from "@/lib/providers/polygon";
import { fetchAggBars } from "@/lib/providers/polygon-largo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CLAIM_TTL_SEC = 22 * 60 * 60;


/** ET post-close window this job must run inside, regardless of UTC offset.
 *
 *  Target 16:15 ET: `fetchDailyMarketSummary` reads Polygon grouped-daily, which settles shortly after
 *  the 16:00 ET cash close. The 90-minute catch-up tail lets the second scheduled fire retry when the
 *  first one errored and released the claim, without ever reaching into the next session.
 *  Env-overridable so the window can be widened operationally without a redeploy. */
function inBangerDiscoveryWindow(now = new Date()): boolean {
  return inEtWindow(
    {
      targetHour: Number(process.env.BANGER_DISCOVERY_HOUR_ET ?? "16"),
      targetMinute: Number(process.env.BANGER_DISCOVERY_MINUTE_ET ?? "15"),
      catchupMin: Number(process.env.BANGER_DISCOVERY_CATCHUP_MIN ?? "90"),
    },
    now
  );
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionDate = todayEt(new Date(started));
  const force = req.nextUrl.searchParams.get("force") === "1";
  const claimKey = `banger:discovery:${sessionDate}`;

  // DST GUARD — BEFORE the claim, deliberately. The schedule fires on two fixed UTC hours so that one of
  // them lands post-close in either offset; this skips the one that does not. Claiming here instead would
  // let the pre-close fire eat the day and lock out the good fire (see the header note).
  if (!force && !inBangerDiscoveryWindow(new Date(started))) {
    const payload = {
      ok: true,
      skipped: true,
      reason: `Outside the post-close ET window for ${sessionDate} — grouped-daily has not settled; not claiming the day so the post-close fire can run`,
    };
    await logCronRun("banger-discovery", started, payload);
    return NextResponse.json(payload);
  }

  if (force) {
    await sharedCacheDel(claimKey).catch(() => undefined);
  }
  const acquired = await sharedCacheSetNx(claimKey, { status: "running", at: started }, CLAIM_TTL_SEC).catch(
    () => true,
  );
  if (!acquired) {
    const payload = { ok: true, skipped: true, reason: `already ran for ${sessionDate} (idempotent skip)` };
    await logCronRun("banger-discovery", started, payload);
    return NextResponse.json(payload);
  }

  try {
    const result = await runBangerCommit({
      fetchGroupedDaily: async () => {
        const summary = await fetchDailyMarketSummary(sessionDate);
        return summary?.results ?? [];
      },
      fetchBars: fetchAggBars,
      insertPosition: insertBangerPosition,
      sessionDate,
    });
    await logCronRun("banger-discovery", started, { ...result, duration_ms: Date.now() - started });
    return NextResponse.json(result);
  } catch (error) {
    // Release the claim so the next fire (or ?force=1) can retry — same fail-open-to-retry
    // discipline as swing-discovery.
    await sharedCacheDel(claimKey).catch(() => undefined);
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/banger-discovery]", error);
    await logCronRun("banger-discovery", started, { ok: false, error: detail, claim_released: true });
    return NextResponse.json({ ok: false, error: "Banger discovery failed", claim_released: true }, { status: 500 });
  }
}
