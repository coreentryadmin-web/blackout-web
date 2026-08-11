// GET /api/public/largo-card/[turnId] — the signed, expiring image URL a social platform fetches.
//
// WHY A PUBLIC ROUTE EXISTS AT ALL. TikTok's photo endpoint (`PULL_FROM_URL`) and Instagram's
// Graph API both FETCH the image themselves; neither accepts raw bytes for a still. A card that
// only exists as a Buffer inside our process cannot be posted to either. `card-link.ts` has minted
// URLs pointing here since it shipped — and this route did not exist, so every link it signed
// pointed at nothing. Same defect class as everything else in this series: a real capability with
// no path to the layer that needs it.
//
// AUTHORISATION IS THE SIGNATURE, AND OWNERSHIP IS STILL THE JOIN. `largo_messages.id` is a
// sequential integer; an unsigned `/card/1234` would let anyone walk the table and render every
// member's desk history. The HMAC binds turn id, OWNER, size, format and expiry together, and the
// owner it carries is handed to the SAME `fetchLargoTurnResults(turnId, userId)` the authenticated
// path uses. There is deliberately no second, unscoped way to read a turn.
//
// READ-ONLY, no session, no cookies. It renders one already-written turn and nothing else.
import { NextRequest, NextResponse } from "next/server";
import { verifyCardLink, type CardLinkParams } from "@/lib/social/card-link";
import { fetchLargoTurnResults } from "@/lib/largo/largo-store";
import { buildVisualBundle } from "@/lib/largo/visual/bundle";
import { routeVisual } from "@/lib/largo/visual/router";
import { renderVisual } from "@/lib/largo/visual/render";
import { answerSectionText } from "@/lib/largo/answer-contract";
import { headlineFromMarkdown } from "@/features/largo/answer/answer-format";
import type { VisualSize } from "@/lib/largo/visual/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * ONE STATUS FOR EVERY REJECTION.
 *
 * A 404 for "no such turn" and a 403 for "bad signature" would let a caller probe which turn ids
 * exist. Every failure below returns the same 404 with the same body.
 */
function refuse(): NextResponse {
  return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ turnId: string }> }) {
  const { turnId: raw } = await ctx.params;
  const turnId = Number(raw);
  const q = req.nextUrl.searchParams;
  const userId = q.get("u") ?? "";
  const size = (q.get("size") ?? "") as VisualSize;
  const format = q.get("format") === "webp" ? "webp" : "png";
  const exp = Number(q.get("exp"));
  const sig = q.get("sig") ?? "";

  if (!Number.isInteger(turnId) || turnId <= 0 || !userId || !sig) return refuse();

  const params: CardLinkParams = { turnId, userId, size, format, exp };
  if (!verifyCardLink(params, sig, Date.now())) return refuse();

  // The signature proves the LINK is ours. It does not prove the turn still exists or still
  // belongs to that user — deletions happen — so the ownership query runs regardless.
  const replayed = await fetchLargoTurnResults(turnId, userId);
  if (!replayed) return refuse();

  const verdict = replayed.answer ? answerSectionText(replayed.answer, "Verdict") : "";
  const headline = verdict
    ? headlineFromMarkdown(verdict, "")
    : replayed.answer
      ? headlineFromMarkdown(replayed.answer, "")
      : "";

  const bundle = buildVisualBundle({
    capturedResults: replayed.toolResults,
    headline: headline || null,
    summary: null,
    bias: null,
    ticker: null,
    envelopeLevels: null,
    envelopeGexShifts: null,
    envelopeSpot: null,
    ledgerRow: null,
    nowMs: Date.now(),
  });

  const question = replayed.question ?? "";
  const route = routeVisual(question, bundle, "AUTO");
  // "Not enough evidence to draw an honest graphic" is a real outcome — see the visual route. A
  // platform fetching this URL gets nothing rather than a card built from nothing.
  if (!route) return refuse();

  try {
    const { buffer, contentType } = await renderVisual({
      template: route.template,
      bundle,
      size,
      question,
      format,
      replayOfTurn: String(turnId),
    });
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // Cacheable only until the link expires — a CDN must never outlive the signature.
        "Cache-Control": `public, max-age=300, s-maxage=300`,
        "X-Robots-Tag": "noindex",
      },
    });
  } catch {
    return refuse();
  }
}
