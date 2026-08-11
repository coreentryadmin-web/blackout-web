/**
 * VISUAL TOKENS — the card system's palette and type scale.
 *
 * NOT A NEW PALETTE. Every value here is the repo's own, copied from one of two places in
 * `src/app/globals.css`:
 *   - the brand ramp at `:root` (--color-void / --color-green / --color-red / --color-cyan / …)
 *   - the Largo semantic set (--largo-bull / --largo-bear / --largo-warn / --largo-ai / …)
 *
 * They are duplicated as TS constants because satori cannot read a stylesheet — it takes inline
 * style objects only. That duplication is a real risk (a token changed in CSS would not follow
 * here), so `tokens.test.ts` parses globals.css and asserts these still match. A card that drifts
 * from the desk's colour code is worse than one that never matched: a member learns the code on
 * the desk and applies it to the graphic.
 *
 * THE COLOUR CODE, verbatim from globals.css:18510:
 *   cyan   → information / live platform data
 *   green  → bullish · positive · confirmed
 *   red    → bearish · risk · invalidated
 *   amber  → watch · caution · stale
 *   purple → LARGO — and ONLY Largo's own synthesis
 *   white  → primary information (the number you came for)
 *   muted  → secondary metadata (labels, units, timestamps)
 */

export const C = {
  /** True page ground — `--color-void`. */
  void: "#040407",
  /** Card ground, one step off void so a card reads as a surface on a dark feed. */
  card: "#080a10",
  panel: "#0c1017",
  rule: "rgba(148,163,184,0.13)",
  ruleSoft: "rgba(148,163,184,0.07)",

  bull: "#34d399",
  bear: "#f87171",
  warn: "#fbbf24",
  info: "#22d3ee",
  /** Largo synthesis. Boundaries only — never body text. */
  ai: "#a78bfa",
  aiDim: "rgba(167,139,250,0.30)",
  aiBg: "rgba(167,139,250,0.07)",

  primary: "#f1f5f9",
  muted: "rgba(148,163,184,0.80)",
  faint: "rgba(148,163,184,0.52)",

  /** Brand lime — the marketing ramp's anchor (`--color-green`). Used for the wordmark only, so
   *  it never competes with the semantic bull green inside the data. */
  brand: "#a3e635",
} as const;

export const FONT = {
  display: "Anton",
  mono: "JetBrains Mono",
} as const;

/** Tone → colour. One place, so every primitive resolves a tone identically. */
export type Tone = "neutral" | "positive" | "negative" | "caution" | "info";
export function toneColor(tone: Tone | null | undefined): string {
  switch (tone) {
    case "positive":
      return C.bull;
    case "negative":
      return C.bear;
    case "caution":
      return C.warn;
    case "info":
      return C.info;
    default:
      return C.primary;
  }
}

/** Level kind → colour. Resistance is above, support below — the desk's convention. */
export function levelColor(kind: string): string {
  switch (kind) {
    case "resistance":
      return C.bear;
    case "support":
      return C.bull;
    case "pivot":
      return C.warn;
    case "spot":
      return C.info;
    default:
      return C.muted;
  }
}

/** Stance → colour, for the system-attribution strip. `regime` is amber because a regime is a
 *  condition, not a vote — the same rule `system-reads.ts` enforces in the answer layer. */
export function stanceColor(stance: string): string {
  switch (stance) {
    case "bullish":
      return C.bull;
    case "bearish":
      return C.bear;
    case "regime":
      return C.warn;
    case "neutral":
      return C.muted;
    default:
      return C.faint;
  }
}

/**
 * A restrained glyph set. Text marks, not emoji — the brief was explicit that this must not look
 * like a Discord signals bot, and an emoji also rasterises inconsistently across platforms.
 *
 * EVERY CODEPOINT HERE MUST EXIST IN ALL THREE COMMITTED FACES, and `tokens.test.ts` reads their
 * cmap tables to enforce it. This is not pedantry: when satori meets a glyph none of its supplied
 * font buffers can draw, it silently falls back to FETCHING A GOOGLE FONT AT RENDER TIME. That
 * turns a pure local render into a network call on the request path, and in a container without
 * egress it fails and the glyph vanishes. `none` was `◦` (U+25E6) — absent from Anton and both
 * JetBrains Mono weights — and every SYSTEM_COMPARISON and system-strip render was quietly making
 * that outbound request. It is now `◇` (U+25C7), which all three faces carry.
 */
export const GLYPH = {
  up: "▲",
  down: "▼",
  flat: "→",
  dot: "·",
  none: "◇",
  regime: "◆",
} as const;
