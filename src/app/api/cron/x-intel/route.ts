import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { logCronRun } from "@/lib/cron-run";
import { xApiEnabled } from "@/lib/x-api";
import { renderDeskCardPng } from "@/lib/x-desk-card";
import {
  selectPostType,
  fetchMarketSnapshot,
  generateTweetContent,
  marketDataReady,
  isPostWindow,
  type PostType,
} from "@/lib/x-content";
import { checkPostGuard, isTweetContentValid } from "@/lib/x-post-guard";
import { xMarketingPostsPaused } from "@/lib/x-marketing-env";
import { saveQueueRow } from "@/lib/x-intel/queue-store";
import type { XIntelQueueDraft } from "@/lib/x-intel/queue-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

function nowET(): Date {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
}

function etDateString(): string {
  const et = nowET();
  const year = et.getFullYear();
  const month = String(et.getMonth() + 1).padStart(2, "0");
  const day = String(et.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function etTimeString(d: Date = nowET()): string {
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds} ET`;
}

function cycleName(postType: PostType): string {
  const et = nowET();
  const hour = String(et.getHours()).padStart(2, "0");
  return `${etDateString()}T${hour}:${postType}`;
}

async function captureAttachments(
  postType: PostType,
  data: Awaited<ReturnType<typeof fetchMarketSnapshot>>,
): Promise<{ url: string | null; source: string }> {
  try {
    const buf = await renderDeskCardPng(postType, data);
    return {
      url: buf ? `/x-intel/${etDateString()}T${nowET().getHours()}/${postType}-desk.png` : null,
      source: "live-desk-card",
    };
  } catch {
    return { url: null, source: "failed" };
  }
}

export async function GET(req: NextRequest) {
  const started = Date.now();

  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!xApiEnabled()) {
    await logCronRun("x-intel", started, {
      ok: false,
      skipped: true,
      reason: "X API credentials not configured",
    });
    return NextResponse.json(
      { ok: false, reason: "X API credentials not configured" },
      { status: 200 },
    );
  }

  if (xMarketingPostsPaused()) {
    await logCronRun("x-intel", started, {
      ok: true,
      skipped: true,
      reason: "X_MARKETING_POSTS_PAUSED",
    });
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "X_MARKETING_POSTS_PAUSED",
    });
  }

  const forceType = req.nextUrl.searchParams.get("type") as PostType | null;
  const et = nowET();
  const postType = forceType ?? selectPostType(et);

  if (!postType) {
    const inWindow = isPostWindow(et);
    await logCronRun("x-intel", started, {
      ok: true,
      skipped: true,
      reason: inWindow
        ? "Outside 2-hour post window"
        : `No post slot at hour ${et.getHours()}`,
    });
    return NextResponse.json({
      ok: true,
      skipped: true,
      hour: et.getHours(),
    });
  }

  // Check queue guard early — if we would be rate-limited for posting,
  // no point generating and queuing a candidate.
  const guard = await checkPostGuard();
  if (!guard.allowed) {
    await logCronRun("x-intel", started, {
      ok: true,
      skipped: true,
      reason: guard.reason,
      postType,
    });
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: guard.reason,
      postType,
    });
  }

  try {
    const data = await fetchMarketSnapshot();

    if (!marketDataReady(postType, data)) {
      const skipped: XIntelQueueDraft = {
        cycle_key: cycleName(postType),
        session_date: etDateString(),
        created_at_et: etTimeString(),
        status: "SKIP",
        ticker_or_market: "SPX",
        headline: "Market snapshot incomplete",
        post_copy: null,
        thread: null,
        franchise: null,
        attachments: [],
        products_referenced: [],
        underlying_evidence: [],
        chronology: null,
        market_outcome: null,
        cta: null,
        reason_selected: "Incomplete market data, market data not ready for post type",
        skip_kind: "QUIET",
        blind_spots: [],
        session_claim: false,
        runners_up: [],
        posted_tweet_id: null,
      };
      await saveQueueRow(skipped);
      await logCronRun("x-intel", started, {
        ok: true,
        queued: true,
        reason: "incomplete market data",
        postType,
      });
      return NextResponse.json({
        ok: true,
        queued: true,
        reason: "Market data incomplete, skip row written",
        postType,
      });
    }

    const generated = await generateTweetContent(postType, data);
    const content = generated?.content ?? null;

    if (!content || !isTweetContentValid(content)) {
      const skipped: XIntelQueueDraft = {
        cycle_key: cycleName(postType),
        session_date: etDateString(),
        created_at_et: etTimeString(),
        status: "SKIP",
        ticker_or_market: "SPX",
        headline: "Content generation failed",
        post_copy: null,
        thread: null,
        franchise: null,
        attachments: [],
        products_referenced: [],
        underlying_evidence: [],
        chronology: null,
        market_outcome: null,
        cta: null,
        reason_selected: "Content generation failed validation, generated content invalid",
        skip_kind: "BLIND",
        blind_spots: [],
        session_claim: false,
        runners_up: [],
        posted_tweet_id: null,
      };
      await saveQueueRow(skipped);
      await logCronRun("x-intel", started, {
        ok: false,
        queued: true,
        reason: "Content generation failed validation",
        postType,
      });
      return NextResponse.json(
        {
          ok: false,
          queued: true,
          reason: "Content generation failed validation",
          postType,
        },
        { status: 200 },
      );
    }

    const { url: attachmentUrl } = await captureAttachments(postType, data);

    const attachments = attachmentUrl
      ? [
          {
            slot: 1 as const,
            role: "PRICE" as const,
            image_url: attachmentUrl,
            caption: `${postType} desk snapshot`,
            source_surface: "market" as const,
            source_url: "https://blackouttrades.com/terminal",
            captured_at_et: etTimeString(),
            view: null,
          },
        ]
      : [];

    const headline = content.split("\n")[0] ?? "Market update";
    const draft: XIntelQueueDraft = {
      cycle_key: cycleName(postType),
      session_date: etDateString(),
      created_at_et: etTimeString(),
      status: "REVIEW",
      ticker_or_market: "SPX",
      headline,
      post_copy: content,
      thread: null,
      franchise: null,
      attachments,
      products_referenced: [],
      underlying_evidence: [],
      chronology: null,
      market_outcome: null,
      cta: null,
      reason_selected: `Scheduled template: ${postType}`,
      skip_kind: null,
      blind_spots: [],
      session_claim: false,
      runners_up: [],
      posted_tweet_id: null,
    };

    const saved = await saveQueueRow(draft);
    if (!saved) {
      await logCronRun("x-intel", started, {
        ok: false,
        error: "Failed to save queue row",
        postType,
      });
      return NextResponse.json(
        { ok: false, error: "Queue save failed" },
        { status: 200 },
      );
    }

    await logCronRun("x-intel", started, {
      ok: true,
      queued: true,
      postType,
      queueId: saved.row.id,
      status: saved.row.status,
    });

    return NextResponse.json({
      ok: true,
      queued: true,
      postType,
      queueId: saved.row.id,
      status: saved.row.status,
      headline,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error";
    await logCronRun("x-intel", started, {
      ok: false,
      error: message,
      postType,
    });
    return NextResponse.json(
      { ok: false, error: "X intel generation failed" },
      { status: 200 },
    );
  }
}
