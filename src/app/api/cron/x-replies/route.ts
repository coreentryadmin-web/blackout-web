import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { xApiEnabled, fetchMentions, postReply } from "@/lib/x-api";
import { xPostFooter } from "@/lib/x-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_REPLIES_PER_RUN = 5;

const REPLY_TEMPLATES = [
  (u: string) =>
    `@${u} Dealer positioning beats chart patterns. What ticker are you watching tomorrow?`,
  (u: string) =>
    `@${u} Appreciate you — we map gamma walls + flow live. What's your go-to setup?`,
  (u: string) =>
    `@${u} Flip level + regime = whether dealers amplify or dampen. That's the edge.`,
];

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
    const mentions = await fetchMentions(15);
    for (const m of mentions) {
      stats.scanned += 1;
      const lower = m.text.toLowerCase();
      if (lower.startsWith("@blackouttrade")) continue;

      const username = m.author_username;
      if (!username || username.toLowerCase() === "blackouttrade") continue;

      const body =
        REPLY_TEMPLATES[stats.replied % REPLY_TEMPLATES.length](username);
      const text = `${body} ${xPostFooter()}`.slice(0, 280);

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
      await new Promise((r) => setTimeout(r, 1500));
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
