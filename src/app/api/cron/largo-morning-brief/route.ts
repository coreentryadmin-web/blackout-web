import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { buildLargoMorningBrief, formatMorningBriefPush } from "@/lib/largo/morning-brief";
import { sendWebPush } from "@/lib/push/send-web-push";
import { dbConfigured, dbQuery } from "@/lib/db";
import { inEtWindow } from "@/features/nighthawk/lib/et-window";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CRON_KEY = "largo-morning-brief";

// EventBridge fires this cron TWICE daily — 13:25 UTC and 14:25 UTC (`schedule_cron_utc:
// "25 13,14 * * 1-5"` in cron-registry.ts) — a dual-band schedule added purely so
// cron-staleness-watchdog wouldn't false-alarm across the EDT/EST boundary (ops #2565, #2569).
// Only ONE of those two fires lands on the intended 9:25 ET open; the other is 8:25 ET (EST) or
// 10:25 ET (EDT) — a full hour off. Unlike nighthawk-morning-confirm (same dual-band pattern),
// this route had NO in-app ET gate, so BOTH fires ran the full pipeline and pushed a web
// notification to every opted-in member every single weekday, year-round — not just during a
// DST transition week. Mirrors nighthawk-morning-confirm's `inMorningWindow` gate.
function inMorningWindow(force: boolean): boolean {
  if (force) return true;
  // 9:25 ET target with a 30-min catch-up (9:25-9:55 ET) — wide enough to absorb scheduling
  // jitter but narrow enough that the OTHER dual-band fire (a full hour off in either direction)
  // always lands outside it.
  return inEtWindow({ targetHour: 9, targetMinute: 25, catchupMin: 30 });
}

/** 9:25 ET weekday morning brief — regime, flip, open plays. Opt-in via session metadata. */
export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!inMorningWindow(force)) {
    const payload = { ok: true, skipped: true, reason: "Outside 9:25-9:55 ET window — use ?force=1 to override" };
    await logCronRun(CRON_KEY, started, payload);
    return NextResponse.json(payload);
  }

  try {
    const brief = await buildLargoMorningBrief();
    const push = formatMorningBriefPush(brief);

    let recipients = 0;
    if (dbConfigured()) {
      const res = await dbQuery<{ user_id: string }>(
        `SELECT DISTINCT user_id FROM largo_sessions
         WHERE metadata->>'morning_brief' = 'true'
           AND updated_at > NOW() - INTERVAL '30 days'`
      );
      for (const row of res.rows) {
        const result = await sendWebPush(
          {
            title: push.title,
            body: push.body,
            url: "/terminal?q=" + encodeURIComponent("Morning brief — what matters at the open?"),
          },
          { userId: row.user_id }
        ).catch(() => null);
        if (result?.sent) recipients += result.sent;
      }
    }

    const result = {
      ok: true,
      brief,
      push_recipients: recipients,
      ms: Date.now() - started,
    };
    await logCronRun("largo-morning-brief", started, result);
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/largo-morning-brief]", error);
    // Detail goes to the LOG and the cron-run row, never to the HTTP body: a raw Error.message
    // here can carry PG error text, internal hostnames or a provider response body, and this
    // route answers an unauthenticated-until-checked HTTP surface. `cron-http-error-redaction`
    // enforces this across every cron route — it caught this one.
    await logCronRun("largo-morning-brief", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "cron failed" }, { status: 500 });
  }
}
