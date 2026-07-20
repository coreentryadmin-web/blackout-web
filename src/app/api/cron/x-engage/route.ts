import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import {
  xApiEnabled,
  lookupUserByUsername,
  fetchUserTweets,
  likeTweet,
  retweet,
  followUser,
  X_BLOCK_RT_USERNAMES,
} from "@/lib/x-api";
import {
  ENGAGEMENT_TARGETS,
  ENGAGE_LIMITS,
} from "@/lib/x-engage-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function GET(req: NextRequest) {
  const started = Date.now();

  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!xApiEnabled()) {
    await logCronRun("x-engage", started, {
      ok: false,
      skipped: true,
      reason: "X API credentials not configured",
    });
    return NextResponse.json(
      { ok: false, reason: "X API credentials not configured" },
      { status: 200 },
    );
  }

  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  const stats = {
    likes: 0,
    retweets: 0,
    follows: 0,
    errors: [] as string[],
    scanned: [] as string[],
  };

  try {
    for (const handle of ENGAGEMENT_TARGETS) {
      if (stats.follows >= ENGAGE_LIMITS.follows) break;
      if (X_BLOCK_RT_USERNAMES.has(handle)) continue;

      const user = await lookupUserByUsername(handle);
      if (!user) {
        stats.errors.push(`lookup failed: ${handle}`);
        await sleep(ENGAGE_LIMITS.delayMs);
        continue;
      }

      stats.scanned.push(user.username);

      if (!dryRun) {
        const followed = await followUser(user.id);
        if (followed) stats.follows += 1;
      } else {
        stats.follows += 1;
      }
      await sleep(ENGAGE_LIMITS.delayMs);

      const tweets = await fetchUserTweets(user.id, 3);
      for (const t of tweets) {
        if (stats.likes >= ENGAGE_LIMITS.likes) break;
        const lower = t.text.toLowerCase();
        const relevant =
          /spx|spy|qqq|0dte|gamma|gex|dealer|options|flow|vix|wall|flip|regime|heat/.test(
            lower,
          );
        if (!relevant) continue;

        if (!dryRun) {
          const ok = await likeTweet(t.id);
          if (ok) stats.likes += 1;
          else stats.errors.push(`like failed: ${t.id}`);
        } else {
          stats.likes += 1;
        }
        await sleep(ENGAGE_LIMITS.delayMs);

        if (
          stats.retweets < ENGAGE_LIMITS.retweets &&
          /\$|\d{3,}|million|conviction|whale/.test(lower)
        ) {
          if (!dryRun) {
            const rt = await retweet(t.id);
            if (rt) stats.retweets += 1;
          } else {
            stats.retweets += 1;
          }
          await sleep(ENGAGE_LIMITS.delayMs);
        }
      }
    }

    await logCronRun("x-engage", started, {
      ok: true,
      dryRun,
      ...stats,
    });

    return NextResponse.json({ ok: true, dryRun, ...stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await logCronRun("x-engage", started, { ok: false, error: message, ...stats });
    return NextResponse.json({ ok: false, error: message, ...stats }, { status: 200 });
  }
}
