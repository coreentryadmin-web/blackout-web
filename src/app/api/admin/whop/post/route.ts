import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { postToWhopForum } from "@/lib/whop-posting";
import {
  fetchMarketContext,
  generateWhopContent,
  fallbackWhopContent,
  WHOP_POST_TYPES,
  type WhopPostType,
} from "@/lib/whop-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * Admin endpoint to manually trigger a Whop post.
 *
 * GET /api/admin/whop/post?type=product_vector          — generate + post
 * GET /api/admin/whop/post?type=product_vector&dry=1     — generate only (preview)
 * GET /api/admin/whop/post?type=platform_intro&pin=1     — generate + post + pin
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawType = req.nextUrl.searchParams.get("type");
  if (!rawType || !WHOP_POST_TYPES.includes(rawType as WhopPostType)) {
    return NextResponse.json(
      {
        error: `Missing or invalid type. Valid: ${WHOP_POST_TYPES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const postType = rawType as WhopPostType;
  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  const pin = req.nextUrl.searchParams.get("pin") === "1";

  if (!process.env.WHOP_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "WHOP_API_KEY not configured" },
      { status: 200 },
    );
  }

  const ctx = await fetchMarketContext();
  const generated = await generateWhopContent(postType, ctx);
  const content = generated ?? fallbackWhopContent(postType, ctx);

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      postType,
      title: content.title,
      content: content.content,
      visibility: content.visibility,
      marketContext: ctx,
    });
  }

  const result = await postToWhopForum({
    title: content.title,
    content: content.content,
    visibility: content.visibility,
    pinned: pin,
  });

  return NextResponse.json({
    ok: result.ok,
    postType,
    postId: result.postId,
    title: content.title,
    visibility: content.visibility,
    pinned: pin,
    error: result.error,
  });
}
