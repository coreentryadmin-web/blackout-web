import "server-only";

/**
 * MARKUP OUTPUT — the same card, as HTML or SVG instead of a PNG.
 *
 * WHY THIS EXISTS. The PNG path is for posting; this is for *seeing it in Largo* and for copying
 * the vector out. Asked for "the SVG/HTML", the temptation is to author a second, markup-flavoured
 * version of each template — and that is exactly the drift this codebase keeps paying for: two
 * renderings of one card that disagree the moment a threshold is tuned.
 *
 * THE SAME COMPONENT TREE SERVES BOTH. The templates are plain React components styled with inline
 * style objects, written to satori's flexbox-only subset. A browser is a strict superset of that
 * subset, so `renderToStaticMarkup` on the identical element produces a card that is
 * pixel-equivalent to the PNG — no second template, no second layout, nothing to keep in sync.
 * satori's own runtime is not exposed by `next/og` (only its `.d.ts` ships), so true vector-text
 * SVG would mean adding a direct dependency; it would also be *worse* here, since HTML gives
 * selectable text and stays crisp at any zoom inside the terminal.
 *
 * TWO FONT STRATEGIES, ON PURPOSE:
 *   - HTML references `Anton` / `JetBrains Mono` by family. The app already loads both via
 *     next/font, so an inline card costs nothing extra and matches the desk exactly.
 *   - SVG EMBEDS them as data URIs, because a copied SVG leaves the app and must carry its own
 *     typography or silently fall back to a system face — the same failure mode found in
 *     the X desk card's old librsvg render, which this codebase has already been bitten by once.
 *
 * The SVG wraps the markup in `<foreignObject>`: valid SVG, correct in any browser, and it keeps
 * the single-source-of-truth property. It is a browser-target vector, not a design-tool one.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReactElement } from "react";
import type { VisualManifest } from "./types";
import type { SizeSpec } from "./sizes";
import { C } from "./tokens";

const FONT_DIR = join(process.cwd(), "src/lib/largo/visual/fonts");

let fontCss: string | null = null;

/**
 * `@font-face` blocks with the brand faces inlined as base64.
 *
 * Cached after the first read: the TTFs are ~400 KB combined and re-encoding them per request
 * would dominate the cost of producing a card that is otherwise pure string building.
 */
async function embeddedFontCss(): Promise<string> {
  if (fontCss) return fontCss;
  const [anton, mono, monoBold] = await Promise.all([
    readFile(join(FONT_DIR, "Anton-Regular.ttf")),
    readFile(join(FONT_DIR, "JetBrainsMono-Regular.ttf")),
    readFile(join(FONT_DIR, "JetBrainsMono-Bold.ttf")),
  ]);
  const face = (family: string, buf: Buffer, weight: number) =>
    `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;` +
    `src:url(data:font/ttf;base64,${buf.toString("base64")}) format('truetype')}`;
  fontCss = [
    face("Anton", anton, 400),
    face("JetBrains Mono", mono, 400),
    face("JetBrains Mono", monoBold, 700),
  ].join("");
  return fontCss;
}

export type VisualMarkup = {
  /** Card markup only — a single self-contained element, safe to inject inline. */
  html: string;
  /** Standalone SVG with fonts embedded. Present only when `withSvg` was requested, because
   *  embedding the faces adds ~530 KB of base64 that an inline preview does not need. */
  svg?: string;
  manifest: VisualManifest;
};

/**
 * Serialise a rendered card element to markup.
 *
 * The element is the SAME one the PNG path rasterises — callers build it once and may take both
 * outputs, which is what guarantees the image a member posts and the card they previewed are the
 * same card.
 */
export async function renderVisualMarkup(params: {
  element: ReactElement;
  spec: SizeSpec;
  manifest: VisualManifest;
  withSvg?: boolean;
}): Promise<VisualMarkup> {
  const { element, spec, manifest } = params;

  // DYNAMIC IMPORT, and the file is `.ts` not `.tsx`, both deliberately. A STATIC
  // `import { renderToStaticMarkup } from "react-dom/server"` fails the Next build outright —
  // "You're importing a component that imports react-dom/server" — because webpack traces the
  // module graph regardless of the `server-only` marker at the top of this file. Deferring the
  // import to call time keeps it out of that graph, and dropping the `.tsx` extension stops Next
  // treating the module as a potential client component in the first place.
  const { renderToStaticMarkup } = await import("react-dom/server");
  const inner = renderToStaticMarkup(element);

  // BOX-SIZING IS THE ONE REAL DRIFT VECTOR, AND IT IS CLOSED HERE.
  //
  // satori resolves every element as BORDER-BOX; a browser defaults to CONTENT-BOX. Rendering the
  // identical tree in both therefore produced different geometry — the first SVG check overflowed
  // horizontally (padding and the 6px left rule adding to a 100%-width child) and dropped the GEX
  // block on top of the pinned footer, while the PNG of the same element was correct. Without this
  // reset the "one tree, two outputs" guarantee is true of the DATA but not of the LAYOUT, which
  // is the half a member would actually notice.
  const reset = `.largo-visual-card,.largo-visual-card *{box-sizing:border-box;margin:0;padding:0;border:0}`;

  // Sized in absolute px so the card is independent of whatever container Largo drops it into.
  // `max-width:100%` with `transform-origin` scaling is deliberately NOT used: reflowing at a
  // smaller width would change the flexbox geometry the PNG shares, so a narrow viewport scrolls
  // the card rather than re-laying it out.
  const html =
    `<style>${reset}</style>` +
    `<div class="largo-visual-card" style="width:${spec.width}px;height:${spec.height}px;` +
    `background:${C.void};overflow:hidden;position:relative" ` +
    `data-template="${manifest.template}" data-as-of="${manifest.dataAsOf}">${inner}</div>`;

  if (!params.withSvg) return { html, manifest };

  const css = await embeddedFontCss();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" ` +
    `viewBox="0 0 ${spec.width} ${spec.height}">` +
    `<style>${css}${reset}</style>` +
    `<rect width="${spec.width}" height="${spec.height}" fill="${C.void}"/>` +
    `<foreignObject x="0" y="0" width="${spec.width}" height="${spec.height}">` +
    // The class is REQUIRED, not cosmetic: the box-sizing reset is scoped to it, and without the
    // class the SVG silently reverts to the browser's content-box and overflows.
    `<div xmlns="http://www.w3.org/1999/xhtml" class="largo-visual-card" ` +
    `style="width:${spec.width}px;height:${spec.height}px;position:relative;overflow:hidden">` +
    `${inner}</div></foreignObject></svg>`;

  return { html, svg, manifest };
}
