import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { xApiEnabled, postTweet, tweetWithImage } from "@/lib/x-api";
import {
  selectPostType,
  fetchMarketSnapshot,
  generateTweetContent,
  pickImageKey,
  MARKETING_IMAGES,
  SCHEDULE,
  type PostType,
} from "@/lib/x-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function nowET(): Date {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
}

async function loadImage(key: string): Promise<Buffer | null> {
  const relPath = MARKETING_IMAGES[key];
  if (!relPath) return null;
  try {
    return await readFile(join(process.cwd(), relPath));
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const started = Date.now();

  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!xApiEnabled()) {
    await logCronRun("x-autopost", started, {
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

  // Validate forced post type against known schedule types
  const validTypes = new Set<string>(SCHEDULE.map((s) => s.type));
  const rawType = req.nextUrl.searchParams.get("type");
  const forceType =
    rawType && validTypes.has(rawType) ? (rawType as PostType) : null;

  const et = nowET();
  const postType = forceType ?? selectPostType(et);

  if (!postType) {
    await logCronRun("x-autopost", started, {
      ok: true,
      skipped: true,
      reason: `No post scheduled for ET ${et.getHours()}:${String(et.getMinutes()).padStart(2, "0")} ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][et.getDay()]}`,
    });
    return NextResponse.json({
      ok: true,
      skipped: true,
      hour: et.getHours(),
      day: et.getDay(),
    });
  }

  try {
    const data = await fetchMarketSnapshot();
    let content = await generateTweetContent(postType, data);

    // X enforces 280 chars; t.co wraps the URL to 23 chars.
    // Content now includes "@blackouttrade www.blackouttrades.com" footer.
    const T_CO_URL = 23;
    const MAX_TOTAL = 280 - T_CO_URL + "www.blackouttrades.com".length;
    if (content && content.length > MAX_TOTAL) {
      const footer = content.slice(content.lastIndexOf("\n"));
      const body = content.slice(0, content.lastIndexOf("\n"));
      content = body.slice(0, MAX_TOTAL - footer.length - 1).trimEnd() + "…" + footer;
    }

    if (!content) {
      await logCronRun("x-autopost", started, {
        ok: false,
        reason: "Content generation returned empty",
        postType,
      });
      return NextResponse.json(
        { ok: false, reason: "empty content", postType },
        { status: 200 },
      );
    }

    if (dryRun) {
      await logCronRun("x-autopost", started, {
        ok: true,
        skipped: true,
        reason: "dry run",
        postType,
        content,
        dataSnapshot: data,
      });
      return NextResponse.json({
        ok: true,
        dryRun: true,
        postType,
        content,
        data,
      });
    }

    // Try to attach a marketing image
    const imgKey = pickImageKey(postType);
    const imgBuf = await loadImage(imgKey);

    const result = imgBuf
      ? await tweetWithImage(content, imgBuf, "image/webp")
      : await postTweet(content);

    await logCronRun("x-autopost", started, {
      ok: true,
      postType,
      tweetId: result.id,
      content: result.text,
      hasImage: !!imgBuf,
      imageKey: imgKey,
    });

    return NextResponse.json({
      ok: true,
      postType,
      tweetId: result.id,
      content: result.text,
      hasImage: !!imgBuf,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error";
    await logCronRun("x-autopost", started, {
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
