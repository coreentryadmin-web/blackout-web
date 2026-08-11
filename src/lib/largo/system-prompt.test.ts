import test from "node:test";
import assert from "node:assert/strict";
import { LARGO_SYSTEM_PROMPT } from "./system-prompt";

/**
 * These lock the two rules that exist because Largo got them WRONG in production, in the same
 * confident voice it uses for verified facts. A prompt is easy to trim during an unrelated edit,
 * and a deleted rule fails silently — the answers just quietly get worse. These are the tripwire.
 */

test("dealer-gamma mechanics: the full convention chain is stated", () => {
  const p = LARGO_SYSTEM_PROMPT;
  // 1. data definition — the sign that creates the bipolar signal
  assert.match(p, /sign = \+1 for calls, −1 for puts/);
  // 2. sign -> dealer position
  assert.match(p, /Positive net GEX ⇒ dealers net \*\*LONG\*\* gamma/);
  assert.match(p, /Negative net GEX ⇒ dealers net \*\*SHORT\*\* gamma/);
  // 3. position -> hedge behaviour, in BOTH directions
  assert.match(p, /long gamma\*\* hedge COUNTER-cyclically: they SELL into rallies and BUY into dips/);
  assert.match(p, /short gamma\*\* hedge PRO-cyclically: they BUY into rallies and SELL into dips/);
});

test("dealer-gamma: DEX carries its own, opposite sign convention", () => {
  // The live error conflated a DELTA reading with a GAMMA response. Both halves must be present
  // for the distinction to be learnable from the prompt.
  assert.match(LARGO_SYSTEM_PROMPT, /dealerDelta = −Σ\(delta · OI\)/);
  assert.match(LARGO_SYSTEM_PROMPT, /GAMMA describes how dealers RESPOND to a move\. DELTA describes where they ARE/);
});

test("dealer-gamma: hedge behaviour may not be inferred from price or premium", () => {
  const p = LARGO_SYSTEM_PROMPT;
  assert.match(p, /Never infer it from price action, from a wall's location, or from a call\/put premium ratio/);
  // And the claim is bounded — an estimated book is not an observed one.
  assert.match(p, /the real book is not observable/);
});

test("evidence absent is not evidence of absence — with the exact live failure", () => {
  const p = LARGO_SYSTEM_PROMPT;
  assert.match(p, /Evidence absent is NOT evidence of absence/);
  // The sentence that shipped: "No dark pool prints today = no institutional conviction visible".
  assert.match(p, /No dark-pool prints surfaced in this window/);
  assert.match(p, /❌ "No institutional conviction\."/);
  // The reason it is wrong, not just the instruction.
  assert.match(p, /futures, baskets, swaps, execution algos and venues we do not see/);
  // And the constructive alternative, so the rule does not just produce silence.
  assert.match(p, /say what makes it informative \(the baseline\)/);
});

/**
 * SECTION SCALING — the contract is a vocabulary, not a checklist.
 *
 * MEASURED 2026-08-11 against production: 10 of 25 answers were flagged over-length, and every one
 * of them had emitted all eight headings for a single-lens question. "DEX lens on QQQ" came back at
 * 3.3k characters with a `Conflicts` section reading "No conflicts — ..." and a `Data` section
 * reading "All reads live and complete."
 *
 * The prompt was self-contradictory, and the losing side was the one stated first and loudest:
 *
 *   1. "APPLIES TO EVERY ANSWER, WITHOUT EXCEPTION" / "MANDATORY ANSWER CONTRACT" — a rule about
 *      WHICH headings are legal, phrased as though it were a rule about HOW MANY to use.
 *   2. "The other five are conditional" — the rule that actually governs, two screens further down
 *      under a sub-heading.
 *   3. "If signals genuinely align, write `No conflicts — ...`" — which directly instructs the
 *      emission of a section (1) makes mandatory and (2) calls conditional. The placeholder text in
 *      the live answers is quoted verbatim from the prompt.
 *
 * So the failure was not the model ignoring the contract; it was the model obeying the strongest
 * instruction present. These assertions keep the vocabulary/completeness distinction explicit.
 */
test("the contract is framed as a heading VOCABULARY, not a completeness checklist", () => {
  const p = LARGO_SYSTEM_PROMPT;
  assert.match(p, /A FIXED VOCABULARY OF HEADINGS, NOT A CHECKLIST TO FILL IN/);
  assert.match(p, /You choose how many of these headings the question earns/);
  assert.match(p, /Using\nall eight on a question that did not need them is a failure of the contract/);
  // The old phrasings are what produced the eight-section default. They must not return.
  assert.doesNotMatch(p, /APPLIES TO EVERY ANSWER, WITHOUT EXCEPTION/);
  assert.doesNotMatch(p, /MANDATORY ANSWER CONTRACT/);
});

test("Conflicts is OMITTED when signals agree — no content-free placeholder", () => {
  const p = LARGO_SYSTEM_PROMPT;
  assert.match(p, /If the\nsignals genuinely align, OMIT this heading entirely/);
  // The exact placeholder that shipped in live answers, quoted from the old prompt.
  assert.doesNotMatch(p, /write\n?\\?`No conflicts — flow, structure and price agree/);
});

test("scaling is anchored at the MIDDLE of the range, not only the two ends", () => {
  // Only "SPX?" (trivial) and a four-clause synthesis (maximal) were exemplified, so a single-lens
  // question — the largest real category — had no anchor and defaulted to maximal.
  const p = LARGO_SYSTEM_PROMPT;
  assert.match(p, /DEX lens on QQQ/, "the mid-scope worked example must be present");
  assert.match(p, /ONE lens on ONE instrument/);
  assert.match(p, /four-section answer: Verdict, Facts, a short Interpretation, Data/);
  // And a general test, so the rule generalises past the three examples.
  assert.match(p, /If it restates the Verdict in different words, drop it/);
});

test("no hardcoded SPX level: a stale anchor becomes a reason to distrust live data", () => {
  const p = LARGO_SYSTEM_PROMPT;
  // The prompt claimed "spot price is in the 5000–6000 range" while SPX traded at 7760.
  assert.doesNotMatch(p, /spot price is in the 5000/);
  assert.match(p, /roughly \*\*10× SPY\*\*/);
  assert.match(p, /your prior is always stale/);
});

/**
 * THE CARD CAPABILITY MUST BE IN THE PROMPT.
 *
 * Measured in production 2026-08-11. Asked "Can you generate me an image for todays Night Hawk
 * plays", Largo replied "I cannot generate images. I'm a market data analysis tool" — rendered on a
 * screen showing the card generator's own template/size/format controls directly beneath it.
 *
 * The model was not wrong to reason that way: the prompt described every desk, every tool and every
 * rich component, and never once mentioned that a turn can be rendered as a PNG. It refused a
 * capability it had no way to know existed. That is the same defect class as the extractor bugs —
 * a real capability with no path to the layer that needs it — and here the missing path was
 * knowledge rather than data.
 *
 * These assertions are the tripwire: the day someone trims this section, the refusal comes back.
 */
test("Largo is told the shareable card exists and must never deny it", () => {
  const p = LARGO_SYSTEM_PROMPT;
  assert.match(p, /\*\*You CAN produce one, and it is already built\.\*\*/);
  assert.match(p, /\*\*Never say you cannot generate images\.\*\*/);
  // The controls are on screen — the refusal is contradicted by the surrounding UI, not just wrong.
  assert.match(p, /controls sit directly under your reply/);
});

test("the card's provenance rule is stated, not just its existence", () => {
  const p = LARGO_SYSTEM_PROMPT;
  // Why Largo does not draw it: values come from the tool results, so a card cannot contradict the
  // answer. Without this, "you can make images" invites it to describe layout or invent a link.
  assert.match(p, /composed from YOUR ANSWER AND THIS TURN'S TOOL RESULTS/);
  assert.match(p, /do not invent a URL for it/);
  // And the one honest "nothing to draw" case, so the rule does not force a card claim on an
  // empty turn.
  assert.match(p, /no tools returned, no numbers/);
});
