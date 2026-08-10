import { NIGHTHAWK_RE, matchesIntent } from "@/lib/largo/intent-keywords";
import { analyzeLargoQuestion } from "@/lib/largo/question-intent";

function withTicker(chips: string[], ticker: string | null | undefined): string[] {
  if (!ticker) return chips;
  const t = ticker.toUpperCase();
  return chips.map((c) => c.replace(/\{ticker\}/g, t));
}

/** Deterministic follow-ups when Haiku is unavailable or returns too few chips. */
export function deterministicLargoFollowups(
  question: string,
  tickerHint?: string | null
): string[] {
  // Previously this first asked the BIE router to classify the question into one of ~20 fixed
  // intents and returned that intent's canned chip list, falling through to the composed chips
  // below only when the router had nothing. That short-circuit is gone with the router: it made
  // the suggestions a function of which hard-coded bucket a phrasing happened to land in, which
  // is exactly the "custom route per phrasing" shape this rebuild removes. The composed path
  // below is derived from the SAME live-feed intent signals the turn actually used, so the chips
  // track what Largo really looked at rather than what a classifier guessed.
  const intent = analyzeLargoQuestion(question, []);
  const chips: string[] = [];

  if (tickerHint) {
    chips.push(`Full {ticker} ecosystem read`);
    chips.push(`{ticker} flow vs dealer walls`);
    chips.push(`What invalidates {ticker}?`);
  }
  if (intent.needsSpxDesk || intent.needsPlayState || !tickerHint) {
    chips.push("What's the SPX desk read?");
    chips.push("Where are dealers positioned on SPX?");
  }
  if (intent.needsFlow || intent.needsFlowAnomalyNearMisses) {
    chips.push("Show HELIX strike stacks");
    chips.push("Any whale prints on the tape?");
  }
  if (intent.needsZeroDteCommand || intent.needsZeroDteRejections) {
    chips.push("Show today's 0DTE board");
    chips.push("Why didn't a name make the grid?");
  }
  if (matchesIntent(question.toLowerCase(), NIGHTHAWK_RE) || intent.needsNighthawkDatedEdition) {
    chips.push("Show tonight's Night Hawk playbook");
  }

  chips.push("Full platform snapshot");
  chips.push("What's the market backdrop?");

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of withTicker(chips, tickerHint)) {
    const c = raw.trim();
    if (!c || seen.has(c.toLowerCase())) continue;
    seen.add(c.toLowerCase());
    out.push(c);
    if (out.length >= 3) break;
  }
  return out;
}
