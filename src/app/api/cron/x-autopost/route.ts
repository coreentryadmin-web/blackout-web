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
  marketDataReady,
  xPostFooter,
  isPostWindow,
  type PostType,
} from "@/lib/x-content";
import { checkPostGuard, isTweetContentValid } from "@/lib/x-post-guard";

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

function trimToLimit(content: string): string {
  const footer = `\n${xPostFooter()}`;
  const maxBody = 280 - footer.length - 1;
  if (content.length <= 280) return content;
  const body = content.slice(0, content.lastIndexOf("\n"));
  return body.slice(0, maxBody).trimEnd() + "…" + footer;
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
  const forcePost = req.nextUrl.searchParams.get("force") === "1";

  const validTypes = new Set<string>([
    "desk_open",
    "desk_flow",
    "desk_ai",
    "desk_matrix",
    "desk_midday",
    "desk_close",
    "desk_evening",
    "weekend_desk",
  ]);
  const rawType = req.nextUrl.searchParams.get("type");
  const forceType =
    rawType && validTypes.has(rawType) ? (rawType as PostType) : null;

  const et = nowET();
  const postType = forceType ?? selectPostType(et);

  if (!postType && !forceType) {
    const inWindow = isPostWindow(et);
    await logCronRun("x-autopost", started, {
      ok: true,
      skipped: true,
      reason: inWindow
        ? "Outside 2-hour post window"
        : `No post slot — next at even ET hour 8–20 (now ${et.getHours()}:${String(et.getMinutes()).padStart(2, "0")})`,
    });
    return NextResponse.json({
      ok: true,
      skipped: true,
      hour: et.getHours(),
      day: et.getDay(),
    });
  }

  if (!postType) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no slot" });
  }

  if (!dryRun && !forcePost) {
    const guard = await checkPostGuard();
    if (!guard.allowed) {
      await logCronRun("x-autopost", started, {
        ok: true,
        skipped: true,
        reason: guard.reason,
        postType,
        ...guard,
      });
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: guard.reason,
        postType,
        ...guard,
      });
    }
  }

  try {
    const data = await fetchMarketSnapshot();

    if (!marketDataReady(postType, data)) {
      await logCronRun("x-autopost", started, {
        ok: true,
        skipped: true,
        reason: "Market snapshot incomplete — will not post placeholder data",
        postType,
        dataSnapshot: data,
      });
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "incomplete market data",
        postType,
        data,
      });
    }

    let content = await generateTweetContent(postType, data);
    if (content) content = trimToLimit(content);

    if (!content || !isTweetContentValid(content)) {
      await logCronRun("x-autopost", started, {
        ok: false,
        reason: "Content generation failed validation",
        postType,
        content,
      });
      return NextResponse.json(
        { ok: false, reason: "invalid or empty content", postType, content },
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
