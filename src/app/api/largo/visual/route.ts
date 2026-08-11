import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { buildVisualBundle, timelineFromLedgerRow } from "@/lib/largo/visual/bundle";
import { routeVisual, IMPLEMENTED_TEMPLATES } from "@/lib/largo/visual/router";
import { buildVisualElement, renderVisual } from "@/lib/largo/visual/render";
import { renderVisualMarkup } from "@/lib/largo/visual/markup";
import { sizeSpec } from "@/lib/largo/visual/sizes";
import { fetchLargoTurnResults } from "@/lib/largo/largo-store";
import { headlineFromMarkdown } from "@/features/largo/answer/answer-format";
import type { VisualSize, VisualTemplateId } from "@/lib/largo/visual/types";

/**
 * POST /api/largo/visual — render a Largo answer as a shareable graphic.
 *
 * TWO MODES, and the split is deliberate:
 *   - `?plan=1` returns JSON ONLY: which template the router picked, why, what it rejected, and
 *     the manifest-shaped preview of what would be drawn. NO image is encoded.
 *   - default returns the image bytes with the manifest in a header.
 *
 * The plan mode exists because the brief requires the Create Visual action to open a PREVIEW
 * rather than generate or download anything. It also means the UI can show "we cannot draw this"
 * before spending a render — and refusing to draw is a first-class outcome here, not an error.
 *
 * THE EVIDENCE COMES FROM THE CALLER, NOT FROM A FRESH QUERY. The client posts the same
 * `capturedResults` the turn already used. This route makes NO market-data calls of its own —
 * see `bundle.ts` for why one snapshot rendered twice is the whole design.
 *
 * READ-ONLY and premium-gated. The entitlement check is deterministic code, never a prompt
 * instruction.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Satori + sharp on a 1080x1920 story is the slow case; measured well under this locally.
export const maxDuration = 60;

type Body = {
  question?: string;
  headline?: string | null;
  summary?: string | null;
  bias?: "bull" | "bear" | "neutral" | null;
  ticker?: string | null;
  capturedResults?: unknown[];
  envelopeLevels?: { label: string; value: number | string }[] | null;
  envelopeGexShifts?: { strike: number; change: number; direction: "stronger" | "weaker" | "flipped" }[] | null;
  envelopeSpot?: number | null;
  ledgerRow?: Record<string, unknown> | null;
  template?: VisualTemplateId | "AUTO" | null;
  size?: VisualSize;
  format?: "png" | "webp" | "svg" | "html";
  replayOfTurn?: string | null;
  /**
   * A persisted Largo turn to build the card from.
   *
   * When present, the server loads THAT turn's own `capturedResults` and uses them instead of
   * whatever the client sent. This is what makes TRADE_RECAP reachable from the UI: raw tool
   * output never crosses to the browser, so the client can only hand back the envelope's levels
   * and gexShifts — a ledger row or flow tape has to be re-read server-side from the turn that
   * originally fetched it. Still ONE snapshot: the stored results are the identical objects the
   * written answer was composed from, not a fresh query.
   */
  turnId?: number | string | null;
};

export async function POST(req: NextRequest) {
  const auth = await authorizePremiumDeskApi(req);
  if (auth instanceof Response) return auth;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const nowMs = Date.now();

  // ── TURN REPLAY ────────────────────────────────────────────────────────────────────────────
  // Ownership is enforced inside `fetchLargoTurnResults` (a JOIN on the session's user_id), not
  // here — `largo_messages.id` is a sequential integer, so a caller-side check would be one
  // forgotten branch away from reading another member's desk history.
  const turnId = body.turnId != null ? Number(body.turnId) : null;
  let replayed: Awaited<ReturnType<typeof fetchLargoTurnResults>> = null;
  if (turnId != null && Number.isFinite(turnId)) {
    const userId = "userId" in auth ? auth.userId : null;
    // A cron-authorised caller has no user to scope ownership against, so turn replay is a
    // user-session-only capability. Marketing reuse passes its own bundle instead.
    replayed = userId ? await fetchLargoTurnResults(turnId, userId) : null;
    if (!replayed) {
      return NextResponse.json(
        {
          renderable: false,
          reason: "turn_not_found",
          detail: "That turn does not exist, is not an answer, or is not yours.",
        },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
  }

  /**
   * THE VERDICT COMES FROM WHAT LARGO ACTUALLY WROTE, when the client has none to send.
   *
   * MEASURED ON A LIVE NVDA CARD: no headline at all. The card opened on the spot price, so the
   * single most useful line — the conclusion — was the one thing missing from a graphic built to
   * be posted. The cause is the same one that broke auto-render: the headline reaching this route
   * is the ENVELOPE's, and `envelopeFromContract` returns null whenever the reply drifts off the
   * section contract. No envelope, no headline, no verdict block (`available: (b) => !!b.headline`).
   *
   * The replayed turn has carried `answer` — the exact prose the member read — since turn replay
   * shipped, and nothing had ever used it. Deriving the headline from it is strictly MORE coherent
   * than the envelope's: the card's lead line is now a sentence Largo actually said about this
   * turn, not a re-parse that may have failed.
   *
   * Client-supplied headline still wins, so an envelope-rich turn is unchanged. And this only
   * applies to REPLAYED turns: a bundle posted without a turn id has no answer text to draw on,
   * and inventing a verdict from tool results is exactly what this library refuses to do.
   */
  const replayedHeadline = replayed?.answer ? headlineFromMarkdown(replayed.answer, "") : "";

  const bundle = buildVisualBundle({
    // Replayed results WIN over anything the client sent: the point of the turn id is that the
    // server, not the browser, decides what evidence the card is built from.
    capturedResults: replayed ? replayed.toolResults : body.capturedResults ?? [],
    headline: body.headline ?? (replayedHeadline || null),
    summary: body.summary ?? null,
    bias: body.bias ?? null,
    ticker: body.ticker ?? null,
    envelopeLevels: body.envelopeLevels ?? null,
    envelopeGexShifts: body.envelopeGexShifts ?? null,
    envelopeSpot: body.envelopeSpot ?? null,
    ledgerRow: body.ledgerRow ?? null,
    nowMs,
  });
  // The lifecycle needs the raw row's stamps, which the bundle does not carry through.
  const row = body.ledgerRow ?? null;
  if (row) bundle.timeline = timelineFromLedgerRow(row);

  // The stored turn's own question is preferred, so a replayed card routes on the wording the
  // answer actually replied to rather than whatever the client chose to send back.
  const question = replayed?.question ?? body.question ?? "";
  const route = routeVisual(question, bundle, body.template ?? "AUTO");

  // NOT AN ERROR. "There is not enough evidence to draw an honest graphic" is a real answer, and
  // the UI shows it instead of a broken card.
  if (!route) {
    return NextResponse.json(
      {
        renderable: false,
        reason: "insufficient_evidence",
        detail: "No template can be filled from this turn's evidence without inventing data.",
        available: IMPLEMENTED_TEMPLATES.map((t) => ({ id: t.id, label: t.label, needs: t.needs })),
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }

  const size = body.size ?? "x_landscape";
  const spec = sizeSpec(size);

  // ── PLAN: what would be drawn, without drawing it.
  if (req.nextUrl.searchParams.get("plan") === "1") {
    return NextResponse.json(
      {
        renderable: true,
        template: route.template,
        matchedIntent: route.matchedIntent,
        rejected: route.rejected,
        size: spec.id,
        dimensions: { width: spec.width, height: spec.height },
        dataAsOf: bundle.asOf,
        freshness: bundle.freshness,
        replayOfTurn: replayed ? String(replayed.id) : null,
        systemsQueried: bundle.systemsQueried,
        // A preview of the evidence, so a member can see what the card will assert before it exists.
        preview: {
          headline: bundle.headline,
          spot: bundle.spot?.display ?? null,
          levels: bundle.levels?.map((l) => ({ label: l.label, value: l.display })) ?? [],
          metrics: bundle.metrics?.map((m) => ({ label: m.label, value: m.value })) ?? [],
          trade: bundle.trade
            ? { ticker: bundle.trade.ticker, graded: bundle.trade.graded, return: bundle.trade.returnPct?.display ?? null }
            : null,
        },
        available: IMPLEMENTED_TEMPLATES.map((t) => ({ id: t.id, label: t.label })),
      },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }

  // ── MARKUP: the same card as HTML/SVG, for inline display in Largo and copy-out.
  //
  // Served from `buildVisualElement`, the SAME tree the PNG rasterises, so the card a member sees
  // inline and the image they post cannot differ. HTML references the app's already-loaded brand
  // faces; SVG embeds them, because a copied SVG leaves the app and must carry its own typography.
  const fmt = body.format ?? "png";
  if (fmt === "html" || fmt === "svg") {
    try {
      const built = buildVisualElement({
        template: route.template,
        bundle,
        size,
        question,
        replayOfTurn: replayed ? String(replayed.id) : body.replayOfTurn ?? null,
        nowMs,
      });
      const markup = await renderVisualMarkup({
        element: built.element,
        spec: built.spec,
        manifest: built.manifest,
        withSvg: fmt === "svg",
      });
      return NextResponse.json(
        {
          renderable: true,
          template: route.template,
          format: fmt,
          dimensions: { width: built.spec.width, height: built.spec.height },
          html: markup.html,
          svg: markup.svg ?? null,
          manifest: markup.manifest,
        },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    } catch (e) {
      return NextResponse.json(
        { renderable: false, reason: "markup_failed", detail: e instanceof Error ? e.message : "unknown" },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }
  }

  // ── RASTER
  try {
    const out = await renderVisual({
      template: route.template,
      bundle,
      size,
      question,
      format: fmt === "webp" ? "webp" : "png",
      replayOfTurn: replayed ? String(replayed.id) : body.replayOfTurn ?? null,
      nowMs,
    });

    return new NextResponse(new Uint8Array(out.buffer), {
      status: 200,
      headers: {
        ...NO_STORE_HEADERS,
        "Content-Type": out.contentType,
        // The manifest travels WITH the bytes so an asset can never be separated from its audit
        // trail by the transport. Base64 because header values must be ASCII-safe.
        "X-Visual-Manifest": Buffer.from(JSON.stringify(out.manifest)).toString("base64"),
        "X-Visual-Template": out.manifest.template,
        "X-Visual-Data-As-Of": out.manifest.dataAsOf,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { renderable: false, reason: "render_failed", detail: e instanceof Error ? e.message : "unknown" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
