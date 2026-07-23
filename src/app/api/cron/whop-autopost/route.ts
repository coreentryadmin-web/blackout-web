import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { postToWhopForum } from "@/lib/whop-posting";
import {
  selectWhopPostType,
  fetchMarketContext,
  generateWhopContent,
  fallbackWhopContent,
  type WhopPostType,
} from "@/lib/whop-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const DEDUP_TTL_SEC = 6 * 3600;
const DEDUP_PREFIX = "whop:autopost:dedup:";

function nowET(): Date {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
}

async function getDedup() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { makeRedis } = await import("@/lib/make-redis");
    return await makeRedis("whop-autopost-dedup", url, { maxRetriesPerRequest: 1 });
  } catch {
    return null;
  }
}

async function isDuplicate(postType: WhopPostType): Promise<boolean> {
  try {
    const redis = await getDedup();
    if (!redis) return false;
    const existing = await redis.get(`${DEDUP_PREFIX}${postType}`);
    return existing !== null;
  } catch {
    return false;
  }
}

async function markPosted(postType: WhopPostType): Promise<void> {
  try {
    const redis = await getDedup();
    if (!redis) return;
    await redis.set(`${DEDUP_PREFIX}${postType}`, new Date().toISOString(), "EX", DEDUP_TTL_SEC);
  } catch {
    // non-fatal
  }
}

export async function GET(req: NextRequest) {
  const started = Date.now();

  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.WHOP_API_KEY) {
    await logCronRun("whop-autopost", started, {
      ok: false,
      skipped: true,
      reason: "WHOP_API_KEY not configured",
    });
    return NextResponse.json(
      { ok: false, reason: "WHOP_API_KEY not configured" },
      { status: 200 },
    );
  }

  const paused = process.env.WHOP_AUTOPOST_PAUSED === "1";
  if (paused) {
    await logCronRun("whop-autopost", started, {
      ok: true,
      skipped: true,
      reason: "WHOP_AUTOPOST_PAUSED",
    });
    return NextResponse.json({ ok: true, skipped: true, reason: "paused" });
  }

  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  const forceType = req.nextUrl.searchParams.get("type") as WhopPostType | null;

  const et = nowET();
  const postType = forceType ?? selectWhopPostType(et);

  if (!postType) {
    await logCronRun("whop-autopost", started, {
      ok: true,
      skipped: true,
      reason: "No scheduled slot",
      hour: et.getHours(),
      day: et.getDay(),
    });
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "No scheduled slot",
    });
  }

  if (!forceType && (await isDuplicate(postType))) {
    await logCronRun("whop-autopost", started, {
      ok: true,
      skipped: true,
      reason: `Already posted ${postType} recently`,
      postType,
    });
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "duplicate window",
      postType,
    });
  }

  try {
    const ctx = await fetchMarketContext();
    const generated = await generateWhopContent(postType, ctx);
    const content = generated ?? fallbackWhopContent(postType, ctx);

    if (dryRun) {
      await logCronRun("whop-autopost", started, {
        ok: true,
        skipped: true,
        reason: "dry run",
        postType,
        title: content.title,
        body: content.content.slice(0, 200),
      });
      return NextResponse.json({
        ok: true,
        dryRun: true,
        postType,
        title: content.title,
        content: content.content,
        visibility: content.visibility,
      });
    }

    const result = await postToWhopForum({
      title: content.title,
      content: content.content,
      visibility: content.visibility,
    });

    if (!result.ok) {
      await logCronRun("whop-autopost", started, {
        ok: false,
        error: result.error,
        postType,
      });
      return NextResponse.json(
        { ok: false, error: result.error, postType },
        { status: 200 },
      );
    }

    await markPosted(postType);

    await logCronRun("whop-autopost", started, {
      ok: true,
      postType,
      postId: result.postId,
      title: content.title,
      visibility: content.visibility,
    });

    return NextResponse.json({
      ok: true,
      postType,
      postId: result.postId,
      title: content.title,
      visibility: content.visibility,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await logCronRun("whop-autopost", started, {
      ok: false,
      error: message,
      postType,
    });
    return NextResponse.json(
      { ok: false, error: message, postType },
      { status: 200 },
    );
  }
}
