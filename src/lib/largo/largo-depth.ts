/**
 * Quick read vs deep dive — model and tool-loop limits per depth mode.
 */

import { COMMENTARY_MODEL, LARGO_MODEL } from "@/lib/providers/anthropic";

export type LargoDepth = "quick" | "deep";

export function parseLargoDepth(raw: unknown): LargoDepth {
  return raw === "quick" ? "quick" : "deep";
}

export function largoDepthConfig(depth: LargoDepth): {
  model: string;
  maxRounds: number;
  maxTokens: number;
  timeoutMs: number;
  label: string;
} {
  if (depth === "quick") {
    return {
      model: COMMENTARY_MODEL,
      maxRounds: 2,
      maxTokens: 2048,
      timeoutMs: 45_000,
      label: "Quick read (Haiku, 2 tool rounds)",
    };
  }
  return {
    model: LARGO_MODEL,
    maxRounds: 10,
    maxTokens: 4096,
    timeoutMs: 90_000,
    label: "Deep dive (Sonnet, full loop)",
  };
}

export function formatDepthBlock(depth: LargoDepth): string {
  if (depth === "quick") {
    return `\n\n## Depth: Quick read\nAnswer in 3–5 tight sentences. Call at most TWO tools total. No long scenario lists.\n`;
  }
  return `\n\n## Depth: Deep dive\nFull cross-desk synthesis with levels, conflicts, and invalidation.\n`;
}
