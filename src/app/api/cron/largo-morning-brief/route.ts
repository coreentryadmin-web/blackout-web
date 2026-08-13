import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { buildLargoMorningBrief, formatMorningBriefPush } from "@/lib/largo/morning-brief";
import { sendWebPush } from "@/lib/push/send-web-push";
import { dbConfigured, dbQuery } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 9:25 ET weekday morning brief — regime, flip, open plays. Opt-in via session metadata. */
export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
