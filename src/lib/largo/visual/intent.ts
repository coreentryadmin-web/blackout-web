/**
 * VISUAL INTENT — did the member ASK for an image?
 *
 * WHY THIS EXISTS. Card generation is currently a button: Largo answers, the member notices the
 * Create Visual action, opens a preview, picks a template, and renders. Every one of those steps
 * is a place to stop, and none of them is what the member asked for when they typed "create an
 * image for tomorrow's NH plays". They did not ask to be shown a picker; they asked for an image.
 *
 * So a question that names the artefact generates it in the same turn, at the size that question
 * implies, with no interaction. The picker stays for the case it was actually good at — refining
 * a card the member has already seen.
 *
 * TWO CLASSES, AND THE DISTINCTION IS THE WHOLE POINT.
 *
 *   EXPLICIT  — "create an image", "make me a card", "generate a graphic for X". The artefact is
 *               the request. Render without asking.
 *   INCIDENTAL — "post this on X", "something I can share". The artefact is implied by what they
 *               plan to do with the answer. Also render, because the intent is unambiguous.
 *
 * A question that merely COULD have a card ("how does TSLA look") is neither, and deliberately does
 * not auto-render: generating an image for every answer would spend a satori render on most turns
 * and put an unrequested asset under an answer that was fine as prose.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

import type { VisualSize } from "./types";

/**
 * The artefact is the request.
 *
 * Anchored on a CREATE VERB plus an IMAGE NOUN, rather than on the noun alone. "The image shows
 * dealers short gamma" and "what does the chart say" both name an artefact and neither is a
 * request to make one; requiring the verb is what separates asking for a card from talking about
 * one. The verb may be up to four words from the noun so "create me a quick image" matches.
 */
const VERB_THEN_NOUN_RE =
  /\b(create|generate|make|build|render|draw|design|produce|give me|show me|export|save)\b[\w\s]{0,24}?\b(image|images|card|cards|graphic|graphics|visual|visuals|infographic|picture|png|poster|chart card|post)\b/i;

/**
 * The artefact named as a TRAILING QUALIFIER, with the verb far away.
 *
 * MEASURED MISS: "Generate how NVDA looks today — as an image". The verb is 28 characters from
 * the noun, past the proximity window, so the request read as an ordinary question and no card
 * was made. Widening that window is the wrong fix — it would start matching "explain the graphic
 * you made" — because the problem is not distance, it is that this phrasing puts the artefact at
 * the END as a qualifier on the whole request rather than as the verb's object.
 *
 * Anchored on "as a/an/in ... image", which is a request by construction: there is no reading of
 * "as an image" that is a question about an existing one.
 */
const TRAILING_ARTEFACT_RE =
  /\b(as|in)\s+(a|an)?\s*(image|card|graphic|visual|infographic|picture|png|poster)\s*(form)?\b\s*[.!?]?\s*$|\bin\s+(image|card|graphic|visual)\s+form\b/i;

const EXPLICIT_RE = new RegExp(`(${VERB_THEN_NOUN_RE.source})|(${TRAILING_ARTEFACT_RE.source})`, "i");

/** The artefact is implied by what they plan to do with it. */
const INCIDENTAL_RE =
  /\b(post (this|it|that)?\s*(on|to)\s*(x|twitter|instagram|ig|linkedin|discord)|for (x|twitter|instagram|ig|linkedin)\b|tweet (this|it|that)|share(able)?\s+(this|it|image|graphic|card)?|something i can (post|share|tweet))\b/i;

export type VisualIntent = {
  wanted: boolean;
  kind: "explicit" | "incidental" | null;
  /**
   * The surface the wording implies.
   *
   * Defaults to `x_landscape` — the platform's own default and the aspect most posts use. A named
   * platform overrides it, because "post this on Instagram" asking for a 1200x630 landscape is a
   * worse answer than no image at all: it is the wrong shape for the surface it was requested for.
   */
  size: VisualSize;
};

const SIZE_HINTS: { re: RegExp; size: VisualSize }[] = [
  // Story/reel surfaces are 9:16.
  { re: /\b(story|stories|reel|reels|tiktok|shorts|vertical|9:16|full screen)\b/i, size: "story" },
  { re: /\b(instagram|ig|square|1:1)\b/i, size: "square" },
  { re: /\b(portrait|tall|4:5)\b/i, size: "x_portrait" },
  { re: /\b(landscape|wide|banner|og image|16:9)\b/i, size: "x_landscape" },
];

/**
 * Read the visual intent out of a question.
 *
 * Returns `wanted: false` for everything that is not a request for an artefact — including
 * questions a card would suit perfectly well. Auto-rendering those would put an unrequested asset
 * under most answers and spend a render on each.
 */
export function detectVisualIntent(question: string): VisualIntent {
  const q = question ?? "";
  const explicit = EXPLICIT_RE.test(q);
  const incidental = !explicit && INCIDENTAL_RE.test(q);
  if (!explicit && !incidental) return { wanted: false, kind: null, size: "x_landscape" };
  const hint = SIZE_HINTS.find((h) => h.re.test(q));
  return { wanted: true, kind: explicit ? "explicit" : "incidental", size: hint?.size ?? "x_landscape" };
}

/**
 * Strip the image request from the question before it is used for COMPOSITION.
 *
 * The composer scores blocks against the question's wording, and "create an image" contributes
 * nothing to which evidence matters — worse, "card" and "post" collide with the flow block's
 * `prints?` and the trade block's vocabulary, so the framing can outvote the subject. "Create an
 * image for today's top 5 performing 0DTE plays" should be composed as "today's top 5 performing
 * 0DTE plays".
 *
 * Only the request framing is removed. The subject, including any platform hint that also carries
 * meaning, is left intact — over-stripping would cost the composer the words it needs.
 */
export function questionSubject(question: string): string {
  return (question ?? "")
    .replace(EXPLICIT_RE, " ")
    .replace(INCIDENTAL_RE, " ")
    .replace(/\b(for|of|about|showing)\b\s*$/i, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
