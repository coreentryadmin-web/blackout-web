import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { xApiEnabled, postTweet, tweetWithImage } from "@/lib/x-api";
import { xPostFooterLine } from "@/lib/x-whop-link";
import { renderDeskCardPng } from "@/lib/x-desk-card";
import { recordPostHook } from "@/lib/x-marketing-meta";
import { recordBudgetUse, pauseForRateLimit } from "@/lib/x-rate-budget";
import {
  selectPostType,
  fetchMarketSnapshot,
  generateTweetContent,
  pickImageKey,
  MARKETING_IMAGES,
  marketDataReady,
  isPostWindow,
  type PostType,
} from "@/lib/x-content";
import { checkPostGuard, isTweetContentValid } from "@/lib/x-post-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

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

function trimToLimit(content: string, postType: PostType): string {
  const footer = `\n${xPostFooterLine(postType)}`;
  const maxBody = 280 - footer.length - 1;
  if (content.length <= 280) return content;
  const body = content.slice(0, content.lastIndexOf("\n"));
  return body.slice(0, maxBody).trimEnd() + "…" + footer;
}

async function resolvePostImage(
  postType: PostType,
  data: Awaited<ReturnType<typeof fetchMarketSnapshot>>,
): Promise<{ buf: Buffer | null; source: string }> {
  try {
    const live = await renderDeskCardPng(postType, data);
    return { buf: live, source: "live-desk-card" };
  } catch {
    const key = pickImageKey(postType);
    const fallback = await loadImage(key);
    return { buf: fallback, source: fallback ? `static-${key}` : "none" };
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

    const generated = await generateTweetContent(postType, data);
    let content = generated?.content ?? null;
    if (content) content = trimToLimit(content, postType);

    if (!content || !isTweetContentValid(content)) {
      await logCronRun("x-autopost", started, {
        ok: false,
        reason: "Content generation failed validation",
        postType,
        content,
        draftBody: generated?.draftBody,
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
        draftBody: generated?.draftBody,
        enhanced: generated?.enhanced,
        data,
      });
    }

    const { buf: imgBuf, source: imageSource } = await resolvePostImage(
      postType,
      data,
    );

    const result = imgBuf
      ? await tweetWithImage(content, imgBuf, "image/png")
      : await postTweet(content);

    const bodyLine = content.split("\n")[0] ?? content;
    await recordPostHook(bodyLine);
    await recordBudgetUse("posts");

    await logCronRun("x-autopost", started, {
      ok: true,
      postType,
      tweetId: result.id,
      content: result.text,
      hasImage: !!imgBuf,
      imageSource,
    });

    return NextResponse.json({
      ok: true,
      postType,
      tweetId: result.id,
      content: result.text,
      hasImage: !!imgBuf,
      imageSource,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error";
    if (message.includes("429") || message.includes("rate limited")) {
      await pauseForRateLimit();
    }
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
