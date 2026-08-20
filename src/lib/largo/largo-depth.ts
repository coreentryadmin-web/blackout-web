/**
 * Concrete vs Deep dive — model limits + prompt contract per answer mode.
 * Concrete = Talon-style: one-line verdict, exact levels, wait when unclear.
 * Deep dive = full breakdown with sections, evidence, and invalidation.
 */

import { COMMENTARY_MODEL, LARGO_MODEL } from "@/lib/providers/anthropic";

// The type + the pure mode parsers live in largo-depth-mode.ts, which imports nothing
// server-only. This module reaches providers/anthropic for the model ids, and that transitively
// imports `server-only` — so a CLIENT module must import the parsers from largo-depth-mode
// directly. Re-exported here so every existing server-side import path keeps working.
export { normalizeLargoDepth, parseLargoDepth } from "@/lib/largo/largo-depth-mode";
export type { LargoDepth } from "@/lib/largo/largo-depth-mode";

import type { LargoDepth } from "@/lib/largo/largo-depth-mode";

export function largoDepthConfig(depth: LargoDepth): {
  model: string;
  maxRounds: number;
  maxTokens: number;
  timeoutMs: number;
  label: string;
} {
  if (depth === "concrete") {
    return {
      model: COMMENTARY_MODEL,
      maxRounds: 3,
      maxTokens: 2048,
      timeoutMs: 45_000,
      label: "Concrete (Haiku, tight read)",
    };
  }
  return {
    model: LARGO_MODEL,
    maxRounds: 10,
    maxTokens: 4096,
    timeoutMs: 75_000,
    label: "Deep dive (Sonnet, full loop)",
  };
}

export function formatDepthBlock(depth: LargoDepth): string {
  if (depth === "concrete") {
    return `
## Answer mode: Concrete
- **Lead with a one-line verdict** that directly answers what they asked (e.g. "Wait — not a trade" / "Bullish above 769").
- Follow with **one tight paragraph**: exact spot, flip, walls, flow — cite tool numbers, not ranges.
- No desk tour, no section headers, no scenario grids, no "Answered N/M parts".
- If unclear or conflicting, say **wait** — do not invent a grade or trade.
- Follow-up chips should be strike-level questions grounded in what you just cited.
`;
  }
  return `
## Answer mode: Deep dive
- Break the read down: verdict → structure → flow → conflicts → invalidation.
- Use sections only when each adds new evidence — no filler headers.
- Cite exact tool numbers; call out what would change the read.
- End with the honest action state (trade / wait / avoid).
`;
}
