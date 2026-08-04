// Cron: ENGINE B whole-market discovery-and-commit — one pass per session day.
//
// WHY a NEW route rather than piggybacking on swing-discovery/zerodte-warm's HANDLER: those routes'
// bodies are already deeply wired to their own engines' deps (swing accumulation memory, 0DTE scan
// cadence). A separate thin route keeps Engine B's kill-switch + wiring isolated and auditable, while
// still reusing swing-discovery's IDEMPOTENCY PATTERN below (a same-day re-fire is a no-op).
//
// SCHEDULE (blackout-infra follow-up — see PR description): this route wants ONE EventBridge fire per
// session day, shortly after the close (grouped-daily settles ~4:15pm ET / 20:15 UTC) — e.g.
// `15 20 * * 1-5` (weekdays 20:15 UTC). No blackout-infra wiring exists yet; until it's added this route
// can be fired manually (`?force=1`) or via an existing wide-band cron that already covers that window.
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
import { runBangerCommit } from "@/lib/banger/commit";
import { insertBangerPosition } from "@/lib/banger/positions-db";
import { fetchDailyMarketSummary } from "@/lib/providers/polygon";
import { fetchAggBars } from "@/lib/providers/polygon-largo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CLAIM_TTL_SEC = 22 * 60 * 60;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionDate = todayEt(new Date(started));
  const force = req.nextUrl.searchParams.get("force") === "1";
  const claimKey = `banger:discovery:${sessionDate}`;

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
