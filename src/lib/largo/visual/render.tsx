import "server-only";

/**
 * RENDER ORCHESTRATOR — bundle + template + size → PNG/WebP + manifest.
 *
 * WHY THIS RASTERISER. Three candidates were tested live before this was written:
 *
 *   - `sharp` alone (the path the X desk card used to use): its SVG backend is librsvg, which
 *     resolves fonts through fontconfig and IGNORES an `@font-face` data URI. Verified by
 *     rendering Anton and DejaVu side by side — both came out DejaVu. That is why the X autopost
 *     desk card was silently rendering in a system fallback rather than the brand face; it has
 *     since been moved onto this same satori path (`src/lib/x-desk-card.tsx`).
 *   - satori via `next/og`: takes font BUFFERS directly, no fontconfig involved, and emits glyph
 *     outlines. Verified live with real Anton + JetBrains Mono. This is the path.
 *   - Chromium/Playwright: full CSS, but ~1-2s per render and a browser in the web container.
 *     Reserved for the optional "supporting evidence" screenshots, not the primary asset.
 *
 * satori's cost is a FLEXBOX-ONLY CSS subset — no grid, no container queries. Every primitive is
 * written to that constraint; see `primitives.tsx`.
 *
 * WebP goes through `sharp`, which is already a production dependency. Measured on the proof card:
 * 25.7 KB PNG → 18.7 KB WebP, ~28% smaller at quality 92.
 *
 * FONTS ARE COMMITTED, NOT FETCHED. `fonts/*.ttf` sit in the repo and are read from disk once and
 * cached. A render path that fetched a font at request time would fail closed on a network blip
 * and — worse — could silently fall back to a different face, changing what a marketing asset
 * looks like without anything erroring.
 */

import type { ReactElement } from "react";
import { loadVisualFonts } from "./font-buffers";
import type { RenderedVisual, VisualBundle, VisualSize, VisualTemplateId } from "./types";
import { sizeSpec } from "./sizes";
import { buildManifest, createRecorder } from "./manifest";
import { MarketMoveCard } from "./templates/market-move";
import { TradeRecapCard } from "./templates/trade-recap";
import { LevelAnalysisCard, focusStrikeFromQuestion } from "./templates/level-analysis";
import { ScreenerCard } from "./templates/screener";
import { RejectionCard } from "./templates/rejection";
import { EmConeCard } from "./templates/em-cone";
import { GammaMapCard } from "./templates/gamma-map";
import { FlowRecapCard } from "./templates/flow-recap";
import { LeaderboardCard } from "./templates/leaderboard";
import { SystemComparisonCard } from "./templates/system-comparison";
import { BeforeAfterCard } from "./templates/before-after";
import { SessionRecapCard } from "./templates/session-recap";
import { SignalTimelineCard } from "./templates/signal-timeline";

/** ET clock label for the card chrome. Null when the instant does not parse — never a fake time. */
function etLabel(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  try {
    return `${new Date(t).toLocaleTimeString("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })} ET`;
  } catch {
    return null;
  }
}

export type RenderVisualParams = {
  template: VisualTemplateId;
  bundle: VisualBundle;
  size: VisualSize;
  question?: string | null;
  format?: "png" | "webp" | "svg" | "html";
  replayOfTurn?: string | null;
  nowMs?: number;
};

/**
 * Build the card element + its manifest, WITHOUT rasterising.
 *
 * Both output paths call this, which is the single-source-of-truth guarantee: the PNG a member
 * posts and the HTML/SVG they previewed are literally the same React tree, so they cannot drift.
 */
export function buildVisualElement(params: RenderVisualParams): {
  element: ReactElement;
  spec: ReturnType<typeof sizeSpec>;
  manifest: ReturnType<typeof buildManifest>;
} {
  const { bundle, question } = params;
  const spec = sizeSpec(params.size);
  const recorder = createRecorder();
  const nowMs = params.nowMs ?? Date.now();
  const asOfLabel = etLabel(bundle.asOf);

  let element: ReactElement;
  switch (params.template) {
    case "MARKET_MOVE":
      element = <MarketMoveCard bundle={bundle} spec={spec} recorder={recorder} asOfLabel={asOfLabel} />;
      break;
    case "TRADE_RECAP":
      // The router guarantees `trade` and `trade.entry` are present before selecting this
      // template; the guard is here so a direct caller cannot bypass that and render an empty
      // performance claim.
      if (!bundle.trade?.entry) throw new Error("TRADE_RECAP requires a trade with an entry");
      element = <TradeRecapCard bundle={bundle} spec={spec} recorder={recorder} asOfLabel={asOfLabel} />;
      break;
    case "LEVEL_ANALYSIS":
      element = (
        <LevelAnalysisCard
          bundle={bundle}
          spec={spec}
          recorder={recorder}
          asOfLabel={asOfLabel}
          focusStrike={question ? focusStrikeFromQuestion(question) : null}
        />
      );
      break;
    case "SCREENER":
      // Guards mirror the router's sufficiency predicates so a DIRECT caller cannot bypass them.
      // The router protects the UI path; these protect every other one.
      if ((bundle.screen?.rows.length ?? 0) < 3) throw new Error("SCREENER requires at least three ranked rows");
      element = <ScreenerCard bundle={bundle} spec={spec} recorder={recorder} asOfLabel={asOfLabel} />;
      break;
    case "REJECTION":
      if (!bundle.rejections?.rows.length) throw new Error("REJECTION requires gate-rejection rows");
      element = <RejectionCard bundle={bundle} spec={spec} recorder={recorder} asOfLabel={asOfLabel} />;
      break;
    case "EM_CONE":
      // The realised path is what makes this a result rather than a forecast.
      if (!bundle.cone || bundle.cone.path.length < 2) throw new Error("EM_CONE requires a realised path");
      element = <EmConeCard bundle={bundle} spec={spec} recorder={recorder} asOfLabel={asOfLabel} />;
      break;
    case "GAMMA_MAP":
      if ((bundle.gammaProfile?.rows.length ?? 0) < 5) throw new Error("GAMMA_MAP requires at least five strikes");
      element = <GammaMapCard bundle={bundle} spec={spec} recorder={recorder} asOfLabel={asOfLabel} />;
      break;
    case "FLOW_RECAP":
      if ((bundle.flow?.rows.length ?? 0) < 3) throw new Error("FLOW_RECAP requires at least three prints");
      element = <FlowRecapCard bundle={bundle} spec={spec} recorder={recorder} asOfLabel={asOfLabel} />;
      break;
    case "TRADE_LEADERBOARD":
      // The denominator guard is duplicated from the router deliberately: a leaderboard whose
      // `graded` is smaller than the rows it draws is a performance claim with a broken
      // denominator, and that must be unreachable from ANY caller, not just the routed one.
      if (
        !bundle.leaderboard ||
        bundle.leaderboard.rows.length < 2 ||
        bundle.leaderboard.graded < bundle.leaderboard.rows.length
      ) {
        throw new Error("TRADE_LEADERBOARD requires at least two graded rows within a consistent tally");
      }
      element = <LeaderboardCard bundle={bundle} spec={spec} recorder={recorder} asOfLabel={asOfLabel} />;
      break;
    case "SYSTEM_COMPARISON":
      if ((bundle.systemReads?.length ?? 0) < 3) throw new Error("SYSTEM_COMPARISON requires at least three system reads");
      element = <SystemComparisonCard bundle={bundle} spec={spec} recorder={recorder} asOfLabel={asOfLabel} />;
      break;
    case "BEFORE_AFTER":
      if (!bundle.beforeAfter?.beforeLabel || !bundle.beforeAfter?.afterLabel || bundle.beforeAfter.rows.length < 2) {
        throw new Error("BEFORE_AFTER requires two labelled instants and at least two measurements");
      }
      element = <BeforeAfterCard bundle={bundle} spec={spec} recorder={recorder} asOfLabel={asOfLabel} />;
      break;
    case "SESSION_RECAP":
      if (!bundle.session?.closeDisplay) throw new Error("SESSION_RECAP requires a settled close");
      element = <SessionRecapCard bundle={bundle} spec={spec} recorder={recorder} asOfLabel={asOfLabel} />;
      break;
    case "SIGNAL_TIMELINE":
      if ((bundle.timeline?.length ?? 0) < 4) throw new Error("SIGNAL_TIMELINE requires at least four timestamped events");
      element = <SignalTimelineCard bundle={bundle} spec={spec} recorder={recorder} asOfLabel={asOfLabel} />;
      break;
    default:
      throw new Error(`Template ${params.template} is registered but not implemented`);
  }

  // The manifest is built here, AFTER the template has rendered and reported what it drew — the
  // recorder is populated during element construction, not before it.
  const manifest = buildManifest({
    template: params.template,
    size: params.size,
    bundle,
    recorder,
    question: question ?? null,
    renderedAtMs: nowMs,
    replayOfTurn: params.replayOfTurn ?? null,
  });

  return { element, spec, manifest };
}

/**
 * Rasterise one visual. Throws only on a genuinely broken template selection — an unimplemented
 * template is a programming error, not a data condition, and failing loudly is right because the
 * alternative is shipping a blank asset.
 */
export async function renderVisual(params: RenderVisualParams): Promise<RenderedVisual> {
  const { element, spec, manifest } = buildVisualElement(params);

  const { ImageResponse } = await import("next/og");
  const fonts = await loadVisualFonts();
  const res = new ImageResponse(element, {
    width: spec.width,
    height: spec.height,
    fonts: fonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: f.style })),
  });
  const png = Buffer.from(await res.arrayBuffer());

  let buffer = png;
  let contentType: RenderedVisual["contentType"] = "image/png";
  if (params.format === "webp") {
    const sharp = (await import("sharp")).default;
    buffer = await sharp(png).webp({ quality: 92 }).toBuffer();
    contentType = "image/webp";
  }

  return { buffer, contentType, manifest };
}
