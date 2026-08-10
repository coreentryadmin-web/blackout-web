/**
 * OUTPUT SIZES.
 *
 * Four surfaces, and the templates must LAY OUT DIFFERENTLY for them rather than scaling one
 * canvas — a 1200×630 landscape card squashed into a 1080×1920 story is the tell that a graphic
 * was automated rather than designed. `scale` is the type multiplier a template applies so a
 * headline holds its optical weight at each aspect; `stack` tells a template to switch from a
 * side-by-side arrangement to a vertical one.
 */

import type { VisualSize } from "./types";

export type SizeSpec = {
  id: VisualSize;
  label: string;
  width: number;
  height: number;
  /** Type scale multiplier relative to the landscape baseline. */
  scale: number;
  /** True when the aspect is tall enough that side-by-side panes stop working. */
  stack: boolean;
  /**
   * DENSE surfaces have little vertical room per unit of width, so templates drop their
   * lowest-priority optional block rather than overflowing.
   *
   * Measured, not guessed: the first landscape renders overflowed 630px by ~60-180px depending on
   * template, and the block that fell off the bottom was the FOOTER — taking the mandatory
   * educational disclaimer with it. The footer is now pinned (see `CardShell`), and `dense` is how
   * a template sheds content before it comes to that.
   */
  dense: boolean;
  /** Outer padding in px. */
  pad: number;
  /** Reserved height for the pinned footer, so content can be bounded above it. */
  footer: number;
};

export const SIZES: Record<VisualSize, SizeSpec> = {
  /** X inline image / OG card — the default, and the one most posts use. Widest but shortest, so
   *  it runs the tightest type scale and sheds optional blocks. */
  x_landscape: { id: "x_landscape", label: "X Landscape", width: 1200, height: 630, scale: 0.8, stack: false, dense: true, pad: 52, footer: 108 },
  /** X portrait — takes more vertical feed real estate on mobile. */
  x_portrait: { id: "x_portrait", label: "X Portrait", width: 1080, height: 1350, scale: 1.05, stack: true, dense: false, pad: 64, footer: 118 },
  square: { id: "square", label: "Square", width: 1080, height: 1080, scale: 0.95, stack: true, dense: false, pad: 60, footer: 110 },
  /** 9:16 story. The tallest, so it gets the largest type and the most aggressive stacking. */
  story: { id: "story", label: "Story", width: 1080, height: 1920, scale: 1.2, stack: true, dense: false, pad: 72, footer: 132 },
};

export const DEFAULT_SIZE: VisualSize = "x_landscape";

export function sizeSpec(size: VisualSize | string | null | undefined): SizeSpec {
  if (typeof size === "string" && size in SIZES) return SIZES[size as VisualSize];
  return SIZES[DEFAULT_SIZE];
}

/** Round to whole px — satori takes numbers, and a fractional font size renders inconsistently. */
export function s(base: number, spec: SizeSpec): number {
  return Math.round(base * spec.scale);
}
