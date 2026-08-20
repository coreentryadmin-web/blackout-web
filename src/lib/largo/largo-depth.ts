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
      // TWO ROUNDS, NOT THREE. Measured on prod 2026-08-20: concrete median 24.5s, p90 34.6s —
      // far too slow for the mode whose whole promise is a fast, direct answer. Each extra round
      // is a full model round-trip with the entire context re-read. A one-line-plus-paragraph
      // answer does not need a third pass; if a question genuinely does, it belongs in Deep dive.
      maxRounds: 2,
      // THE OUTPUT CAP IS THE SPEED FIX. Generation time scales with tokens produced, and concrete
      // was emitting ~5,650 chars (~1,400 tokens) against a target of one paragraph — so most of
      // that 24.5s was spent writing prose the mode was never supposed to produce. 900 tokens
      // (~3,600 chars) is deliberately well ABOVE the ~700-char target: the prompt does the
      // shaping, and this is only a backstop, because a mid-sentence truncation is worse for a
      // member than a long answer.
      maxTokens: 900,
      timeoutMs: 30_000,
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

The eight-section contract does NOT apply here. Do not emit **Verdict**, **Facts**,
**Interpretation**, **Confidence**, **Conflicts**, **Risk**, **Data** or **Bottom line** — not as
headings, not as bold inline labels, not in any form. No bullet lists. No tables. Plain prose only,
one to two short paragraphs.

ANSWER ONLY WHAT WAS ASKED. If they asked where the walls are, give the walls — do not also deliver
the flip, the flow, the regime, the play and the invalidation. Every fact you add that they did not
ask for makes the one they did ask for harder to find. A narrow question gets a narrow answer.

**The first sentence must BE the answer**, with the decisive word first and the reasoning attached
to it. Not a preamble, not a restatement of the question:

  "Divergent — only SPY is readable as agreeing, with SPXW and QQQ both dissenting, so no
   directional pull on SPY's floor is confirmed right now."

  "AAPL flow skews call-heavy: $178.3M single-leg premium today, 72.8% calls, put/call 0.37."

Then at most one more paragraph carrying the specific numbers that justify it — exact strikes,
exact levels, exact premiums, with the distance or ratio that makes them mean something ("2pts /
0.71% below spot", "26% of king"). Numbers inline, in prose.

**Target 400-700 characters. Hard ceiling 1,200.** If the question genuinely needs more than that,
answer the asked part and say Deep dive covers the rest — do not quietly grow Concrete into it.

Keep the data honesty, lose the heading: if a read was stale, missing or unavailable, say so in a
clause inside the sentence it affects ("VIX unavailable, so no vol confirmation"). Never omit it
silently; never give it its own section.

If unclear or conflicting, say **wait** and say what would resolve it — do not invent a grade or a
trade.
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
