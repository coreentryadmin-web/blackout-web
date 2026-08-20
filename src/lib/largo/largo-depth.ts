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
    // THIS BLOCK MUST OVERRIDE THE SECTION CONTRACT EXPLICITLY.
    //
    // The system prompt has no notion of answer mode and states, unconditionally, that "Verdict
    // and Data are required on every answer, however short", on top of an eight-section contract.
    // This block used to say only "no section headers" — a small, quiet instruction against a
    // large, emphatic one. The model followed the system prompt, exactly as it should when two
    // instructions conflict and neither claims precedence.
    //
    // Measured on prod, 44 scenarios, 2026-08-20:
    //   Concrete median 5,650 chars (max 6,883)
    //   Deep dive median 4,960 chars (max 8,186)
    // Concrete answers were LONGER than Deep dive ones — the mode was inert, and every reply came
    // back with **Verdict:** / **Facts:** / **Interpretation:** / **Bottom line:** headings.
    //
    // So this now names the sections it collapses and says which instruction wins. The honesty
    // guarantee behind **Data** is deliberately KEPT and moved inline rather than dropped: the
    // system prompt is right that "a silent omission is the one failure a member cannot detect for
    // themselves", and that is true at any length. What Concrete removes is the heading, not the
    // disclosure.
    return `
## Answer mode: Concrete — THIS OVERRIDES THE SECTION CONTRACT ABOVE

When this mode is active the eight-section contract does NOT apply. Do not emit **Verdict**,
**Facts**, **Interpretation**, **Confidence**, **Conflicts**, **Risk**, **Data** or **Bottom line**
as headings. Write prose.

- **Open with the answer in one line** — the thing they asked, decided (e.g. "Wait — not a trade" /
  "Bullish above 6,450").
- **Then one tight paragraph**: exact spot, flip, walls, flow. Cite tool numbers, not ranges.
- **Target 900 characters, hard ceiling 1,600.** If the read genuinely needs more, the member should
  switch to Deep dive — do not quietly grow Concrete into it.
- **Keep the data honesty, lose the heading.** If a read was stale, missing or unavailable, say so
  in a short clause inside the paragraph ("VIX unavailable, so no vol confirmation"). Never omit it
  silently; never give it its own section.
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
