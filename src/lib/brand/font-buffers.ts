/**
 * BRAND FONT BUFFERS — the one place any satori render gets its faces from.
 *
 * satori takes font BUFFERS, which is the whole reason the visual system uses it: `sharp`'s SVG
 * backend is librsvg, which resolves fonts through fontconfig and IGNORES an `@font-face` data
 * URI, so an SVG-through-sharp render silently falls back to whatever the container has (DejaVu).
 * Passing buffers removes fontconfig from the picture entirely.
 *
 * FONTS ARE COMMITTED, NOT FETCHED. `fonts/*.ttf` sit in the repo and are read from disk once and
 * cached. A render path that fetched a font at request time would fail closed on a network blip
 * and — worse — could silently fall back to a different face, changing what a marketing asset
 * looks like without anything erroring.
 *
 * Extracted out of `render.tsx` so the X autopost desk card (`src/lib/x-desk-card.tsx`) loads the
 * identical buffers rather than growing a second, drift-prone copy of this block.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const FONT_DIR = join(process.cwd(), "src/lib/brand/fonts");

export type LoadedFont = { name: string; data: Buffer; weight: 400 | 700; style: "normal" };

let fontCache: LoadedFont[] | null = null;

export async function loadVisualFonts(): Promise<LoadedFont[]> {
  if (fontCache) return fontCache;
  const [anton, mono, monoBold] = await Promise.all([
    readFile(join(FONT_DIR, "Anton-Regular.ttf")),
    readFile(join(FONT_DIR, "JetBrainsMono-Regular.ttf")),
    readFile(join(FONT_DIR, "JetBrainsMono-Bold.ttf")),
  ]);
  fontCache = [
    { name: "Anton", data: anton, weight: 400, style: "normal" },
    { name: "JetBrains Mono", data: mono, weight: 400, style: "normal" },
    { name: "JetBrains Mono", data: monoBold, weight: 700, style: "normal" },
  ];
  return fontCache;
}
