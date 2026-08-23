import test from "node:test";
import assert from "node:assert/strict";

import { applyVerificationCaveat } from "@/lib/largo/turn-outcome";
import { applyPlanCaveat } from "@/lib/largo/core/plan";
import { applyCoherenceCaveat } from "@/lib/largo/core/coherence";
import { applyConflictCaveat } from "@/lib/largo/core/cross-source";
import { auditLargoAnswerGrounding, LARGO_RUNTIME_CAUTION_MARKER } from "@/lib/bie/verifier";
import { splitAnswerCaveats, type AnswerCaveat } from "./answer-caveats";

/**
 * THE PRODUCERS AND THE MATCHER WERE TWO HAND-KEPT LISTS, AND THEY HAD DRIFTED — THREE WAYS.
 *
 * Largo appends honesty caveats post-generation as trailing `> **Heading.**` blocks;
 * `splitAnswerCaveats` peels those off the body and `<LargoAnswerCaveats>` renders each as a
 * labelled callout. Nothing bound the strings the producers WRITE to the patterns the matcher
 * LOOKS FOR, so a producer could be edited — or written in a different shape from the start — and
 * the only symptom was a caveat quietly losing its identity on the way to the member.
 *
 * Measured on this tree before the fix, by running each real producer through the real matcher:
 *
 *   verification     kinds=[]          — not split off AT ALL; stayed buried in the prose
 *   plan             kinds=[other]     — split off, but rendered under the generic label "Note"
 *   coherence        kinds=[coherence] — fine
 *   source-conflict  kinds=[source-conflict] — fine
 *
 * The verification one is the expensive half. It emitted italic prose (`_Data check: …_`) while the
 * UI had the `verification` kind, its regex AND its "Grounding note" label wired end to end,
 * waiting for a string nothing in the codebase ever produced. And it is the caveat that says the
 * answer's own NUMBERS could not be traced to data pulled this turn — the single signal a member
 * most needs set apart from the prose, and the only one that was not.
 *
 * The third drift was in the same family and invisible from the UI: `auditLargoAnswerGrounding`
 * decides "already disclosed" by looking for `LARGO_RUNTIME_CAUTION_MARKER`, whose value was
 * `"BIE verification"` — also never emitted. So the cron re-flagged every low-coverage answer as an
 * undisclosed one, including the ones a member had already been warned about.
 *
 * This file is the binding. It runs each REAL producer through the REAL matcher and asserts the
 * kind, so a heading edited on one side fails here instead of silently degrading a member-facing
 * honesty signal. Behavioural, not a source-scrape: it survives the strings being reworded, and
 * fails only when the two sides actually disagree.
 */

const BODY = "**Verdict** — SPX is chopping.\n\n**Data** — spot 7777.7, 43.2% call share, 9812 contracts.";

/** Each real producer, invoked with an input that triggers it, and the kind the UI must assign. */
const PRODUCERS: ReadonlyArray<{ kind: AnswerCaveat["kind"]; label: string; emit: () => string }> = [
  {
    kind: "verification",
    label: "grounding / Layer-4 coverage",
    emit: () => applyVerificationCaveat(BODY, { total: 6, verified: 1, unverified: [1, 2], coverage: 0.17 }),
  },
  {
    kind: "plan",
    label: "timeframe / plan violation",
    emit: () =>
      applyPlanCaveat(BODY, [
        { code: "historical_answered_from_live_only", detail: "Asked about 10:15; sources are live-only." },
      ]),
  },
  {
    kind: "coherence",
    label: "verdict contradicts its own facts",
    emit: () =>
      applyCoherenceCaveat(BODY, [
        { noun: "open plays", claim: "there are no open plays", evidence: "20 open positions", count: 20 },
      ]),
  },
  {
    kind: "source-conflict",
    label: "two sources disagree on spot",
    emit: () =>
      applyConflictCaveat(BODY, [
        {
          ticker: "SPX",
          spreadPct: 1.4,
          min: 7700,
          max: 7810,
          readings: [
            { source: "result[0]", ticker: "SPX", field: "spot", value: 7700 },
            { source: "result[1]", ticker: "SPX", field: "spot", value: 7810 },
          ],
        },
      ]),
  },
];

for (const { kind, label, emit } of PRODUCERS) {
  test(`the ${label} caveat round-trips to kind "${kind}" — producer and matcher agree`, () => {
    const { body, caveats } = emit() === BODY ? { body: BODY, caveats: [] } : splitAnswerCaveats(emit());
    assert.ok(caveats.length > 0, `nothing was split off — the producer's heading matches no pattern`);
    const kinds = caveats.map((c) => c.kind);
    assert.ok(
      kinds.includes(kind),
      `classified as [${kinds.join(",")}] instead of "${kind}". A caveat rendered as "other" loses ` +
        `its label and its styling; one that is not split off at all stays buried in the prose.`
    );
    assert.ok(!body.includes(">"), "the caveat must be peeled OFF the body, not left in it");
  });
}

test("no producer's caveat is classified as the generic fallback kind", () => {
  // "other" is the matcher's shrug. It is correct for something unrecognised, and always wrong for
  // a caveat this pipeline itself wrote — that combination is exactly how the timeframe warning
  // shipped under the label "Note".
  for (const { kind, emit } of PRODUCERS) {
    const { caveats } = splitAnswerCaveats(emit());
    assert.ok(
      !caveats.some((c) => c.kind === "other"),
      `the ${kind} producer emitted a heading the matcher does not recognise`
    );
  }
});

test("REGRESSION: the grounding caveat is a blockquote, so the terminal can render it as a callout", () => {
  const out = applyVerificationCaveat(BODY, { total: 6, verified: 1, unverified: [1, 2], coverage: 0.17 });
  assert.match(out, /\n> \*\*Grounding note\.\*\*/, "must be a trailing blockquote, not italic prose");
  assert.doesNotMatch(out, /_Data check:/, "the italic form matched nothing and stayed in the body");
});

test("REGRESSION: the cron can see that a caveat was disclosed — the marker is what the producer emits", () => {
  // `alreadyDisclosed` was permanently false because the constant said "BIE verification" and the
  // producer wrote "_Data check:". Every already-warned answer was re-flagged as undisclosed.
  const answer = "**Verdict** — 7777.7 spot, 43.2% share, 9812 contracts, 55.5 delta, 1234.5 gamma.";
  const caveated = applyVerificationCaveat(answer, { total: 5, verified: 1, unverified: [1], coverage: 0.2 });
  assert.ok(caveated.includes(LARGO_RUNTIME_CAUTION_MARKER), "the producer must emit the marker the auditor seeks");
  assert.equal(
    auditLargoAnswerGrounding(caveated, []).shouldFlag,
    false,
    "an answer that already carries the caveat must not be re-flagged as an undisclosed one"
  );
  // ...and an ungrounded answer with NO caveat is still flagged, so the fix did not blind the cron.
  assert.equal(auditLargoAnswerGrounding(answer, []).shouldFlag, true);
});

test("a caveat-free answer is untouched — no producer fires on clean input", () => {
  assert.equal(applyVerificationCaveat(BODY, { total: 6, verified: 6, unverified: [], coverage: 1 }), BODY);
  assert.equal(applyPlanCaveat(BODY, []), BODY);
  assert.equal(applyCoherenceCaveat(BODY, []), BODY);
  assert.equal(applyConflictCaveat(BODY, []), BODY);
  assert.deepEqual(splitAnswerCaveats(BODY).caveats, []);
});
