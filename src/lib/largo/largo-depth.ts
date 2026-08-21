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
  /** PER-ROUND request timeout. Not a loop budget — see `loopBudgetMs`. */
  timeoutMs: number;
  /**
   * WALL-CLOCK budget for the whole tool loop, across every round.
   *
   * `timeoutMs` is per REQUEST and always was — anthropic.ts passes it as the client's `timeout` on
   * each round, and its own comment says it exists so "a single slow round can't hang". Nothing
   * bounded the loop itself, so with `maxRounds: 10` a Deep turn was unbounded in practice: ten
   * rounds each individually inside the per-round cap add up with nothing stopping them.
   *
   * The budget the loop SHOULD have had already existed and was never wired to the loop.
   * `largoToolLoopBudgetMs()` in providers/config.ts is documented as the "Anthropic tool-loop
   * budget — route deadline minus prefetch/post overhead" and computes exactly that (100s route
   * deadline − 20s). largo-terminal then spent it as a per-ROUND `timeoutMs` clamp. So the deep
   * value here is that same 75s, and largo-terminal clamps it against the live env-tunable function
   * rather than this constant drifting away from it.
   *
   * Sizing is fixed by the route, NOT by the ALB. `/api/market/largo/query` races every turn
   * against `largoMemberRouteDeadlineMs()` (100s) and returns its own member-visible message. A
   * loop budget at or above that could never fire — the route would win first and the member would
   * get the generic route-timeout copy instead of the partial answer the loop had already written.
   * The loop must give up first, with enough headroom left for verifyClaims, the caveat pass and
   * persistence to run on what it returns.
   *
   * Measured on prod 2026-08-20: Deep turns of 81.7s, 89.8s and 98.3s against what everyone read as
   * a "75s timeout". Under this budget those turns return the partial answer accumulated so far
   * instead of nothing.
   */
  loopBudgetMs: number;
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
      // Concrete runs 2 rounds; its budget matches the per-round cap because a tight loop that
      // needs longer than one round's worth of wall clock is not a Concrete answer any more.
      loopBudgetMs: 30_000,
      label: "Concrete (Haiku, tight read)",
    };
  }
  return {
    model: LARGO_MODEL,
    maxRounds: 10,
    maxTokens: 4096,
    timeoutMs: 75_000,
    // Mirrors `largoToolLoopBudgetMs()`'s default. largo-terminal clamps against the live function,
    // so lowering LARGO_TOOL_LOOP_BUDGET_MS or the route deadline still tightens this without a
    // deploy — this constant is the ceiling, not the authority.
    loopBudgetMs: 75_000,
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
exact levels, exact premiums. Numbers inline, in prose.

**NO NUMBER WITHOUT ITS RELATION.** A bare figure is telemetry, not an answer — the member cannot
tell whether it is big, near, or worth acting on. Every number arrives with what it is measured
against: not "140 puts" but "140 puts (Aug 21, 1DTE), 8.3% below spot at $152.66"; not "307.5" but
"the 307.5 floor, 2pts / 0.71% below spot"; not "the 312.5 gate" but "the 312.5 gate at 26% of
king". Strike, expiry, distance, share-of-the-biggest — whichever of these makes the figure mean
something.

**SAY WHAT IT MEANS, NOT WHAT IT IS CALLED.** Never dump indicator names and values and leave the
member to decode them. "Tide bullish, NOPE +0.50, TICK +265, TRIN 2.0" is a symbol dump, not a
sentence. Write the mechanism in plain English: "dealers are long gamma at 769 and defending it",
"SPX is capped at 7725 and accelerates below 7710 while QQQ accelerates above 717 — they are
pulling opposite ways, not reinforcing". Use the desk's vocabulary where it is the precise word,
but make the sentence readable on its own.

Do not attach source tags to facts — no "(SPX desk · live)", no "(GEX heatmap · live)". The freshness
and provenance rails already carry that. Inline tags make prose unreadable.

**TWO LENGTH TIERS, because two kinds of question are being asked.**

- A SINGLE-FACT question — where is the flip, where are the walls, what is spot, what is max pain —
  targets **400-700 characters**. One answer, its relation, done.
- A PLAY question — what should I trade, best 3DTE setup, which strike — targets **700-1,100** and
  may reach **1,300**. It legitimately carries more: the contract, why that strike, the probability
  with its breakeven, and the invalidation. Those are four facts a member cannot act without, and
  cutting one to hit a word count makes the answer unusable rather than tight.

This is a real tension and it is resolved deliberately: brevity serves the member, and so does a
complete play. When they conflict, the play wins — but ONLY for the four items above. Everything
else in a play answer obeys the same rules as any other: no sections, no bullets, no regime tour,
no restating the flip and the flow and the tape because they happen to be in context.

Hard ceiling **1,300** either way. If the question genuinely needs more than that,
answer the asked part and stop. The follow-up chips under your answer are how the member reaches
the rest — the adjacent reads they might want next are OFFERED there, not pre-emptively dumped
here. Trust them to ask. That is what lets a short answer stay complete.

Keep the data honesty, lose the heading: if a read was stale, missing or unavailable, say so in a
clause inside the sentence it affects ("VIX unavailable, so no vol confirmation"). Never omit it
silently; never give it its own section.

If unclear or conflicting, say **wait** and say what would resolve it — do not invent a grade or a
trade.
`;
  }
  // WHAT THE RENDERER ACTUALLY SHOWS DECIDES WHAT IS WORTH WRITING.
  //
  // MEASURED ON PROD 2026-08-20, 8 live Deep answers: median 3,524 chars and ~56s per turn (max
  // 4,201 chars / 103s — past the 100s route deadline). Of the eight contract sections, only
  // `Interpretation` and `Conflicts` reach the page as prose. Everything else is either rendered
  // STRUCTURALLY (Verdict -> headline, Facts -> evidence cards, Confidence -> level+why,
  // Risk -> invalidation, Data -> freshness chips) or dropped outright by policy
  // (`Bottom line` is in REDUNDANT_BY_CONSTRUCTION — generated every turn, shown never).
  //
  // So the model was spending a minute writing thousands of characters the member never sees.
  // That is simultaneously the length complaint, the latency complaint and the "answer only what
  // I asked" complaint, because generation time scales with tokens produced.
  //
  // This block does NOT weaken the contract — the terminal parses those sections into the cards,
  // and an answer that abandons them renders as flat text and loses all of it. It tells the model
  // which sections are PROSE the member reads versus which are STRUCTURED INPUT, so each is
  // written at the length its destination justifies.
  return `
## Answer mode: Deep dive

The terminal parses your sections. Some become prose the member reads; some become cards, chips
and labels. Write each for where it lands — length that never reaches the page is latency the
member pays for and nothing else.

**PROSE — the member reads these as written. Put your reasoning here.**
- **Interpretation** — what the facts MEAN. This is the section the answer lives in.
- **Conflicts** — only when the evidence genuinely disagrees with itself. OMIT the heading entirely
  when signals align; a Conflicts section saying there are no conflicts is a heading carrying no
  information.

**STRUCTURED — these are parsed into UI, not shown as paragraphs. Be exact and brief.**
- **Verdict** — one or two sentences; becomes the headline. Not a paragraph.
- **Facts** — one measurement per line; each becomes an evidence row. No prose padding.
- **Confidence**, **Risk**, **Data** — parsed into the confidence level, the invalidation line and
  the freshness chips. State them plainly; do not narrate around them.

**Do NOT write a "Bottom line" section.** It is dropped before render — every character of it is
wasted, on every answer. Your Verdict already is the takeaway.

**ANSWER ONLY WHAT WAS ASKED.** A question about the gamma flip gets the flip, its distance, and
what that implies — not the flow, the condor, the confluence tier and the session plan as well.
Adjacent reads are OFFERED by the follow-up chips; a member who wants them will ask. Every
unrequested fact makes the requested one harder to find.

**LENGTH.** A single-fact question (where is the flip / the walls / max pain) targets
**900-1,600 characters** total. A play or multi-part question may reach **2,600**. Past that you
are not being thorough, you are being long: an answer nobody finishes is not more informative than
one they do.

Cite exact tool numbers. Name what would change the read. End on the honest action state
(trade / wait / avoid).
`;
}
