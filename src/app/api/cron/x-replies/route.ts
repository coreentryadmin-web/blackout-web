import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { xApiEnabled, fetchMentions, postReply } from "@/lib/x-api";
import { pickMentionReply } from "@/lib/x-engage-replies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_REPLIES_PER_RUN = 10;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!xApiEnabled()) {
    return NextResponse.json({ ok: false, reason: "X API not configured" });
  }

  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  const stats = { replied: 0, scanned: 0, errors: [] as string[] };

  try {
    const mentions = await fetchMentions(20);
    for (const m of mentions) {
      stats.scanned += 1;
      const username = m.author_username;
      if (!username || username.toLowerCase() === "blackouttrade") continue;

      const text = pickMentionReply(username, m.text).slice(0, 280);

      if (!dryRun) {
        try {
          await postReply(text, m.id);
          stats.replied += 1;
        } catch (e) {
          stats.errors.push(e instanceof Error ? e.message : "reply failed");
        }
      } else {
        stats.replied += 1;
      }
      await new Promise((r) => setTimeout(r, 1200));
      if (stats.replied >= MAX_REPLIES_PER_RUN) break;
    }

    await logCronRun("x-replies", started, { ok: true, dryRun, ...stats });
    return NextResponse.json({ ok: true, dryRun, ...stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown";
    await logCronRun("x-replies", started, { ok: false, error: message });
    return NextResponse.json({ ok: false, error: message });
  }
}
