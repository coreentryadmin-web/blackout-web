import { test } from "node:test";
import assert from "node:assert/strict";

import { reactionQualifier, settledReactions } from "./meridian-reaction-display";

const base = {
  reaction_pct: -4.2 as number | null,
  session_change_pct: -4.2 as number | null,
  reaction_basis: "bmo_session" as const,
  reaction_settled: true as boolean | null,
};

test("a settled, known-timing reaction needs no qualifier — the UI stays quiet", () => {
  assert.equal(reactionQualifier(base), null);
  assert.equal(reactionQualifier({ ...base, reaction_basis: "amc_next_session" }), null);
});

test("an unsettled reaction is marked live — the BEKE case", () => {
  // Production served a moving number at 09:46 ET on a session closing at 16:00, unmarked.
  const q = reactionQualifier({ ...base, reaction_settled: false });
  assert.equal(q?.mark, "live");
  assert.equal(q?.kind, "live");
  assert.equal(q?.provisional, true);
  assert.match(q!.title, /has not closed/i);
});

test("an assumed-session reaction is marked assumed, and the tooltip says WHY it matters", () => {
  const q = reactionQualifier({ ...base, reaction_basis: "assumed_report_session" });
  assert.equal(q?.mark, "assumed");
  assert.equal(q?.kind, "assumed");
  assert.equal(q?.provisional, true);
  // The consequence, not just the caveat: 48% of these flip sign read the other way.
  assert.match(q!.title, /opposite sign/i);
});

test("unsettled outranks assumed when both apply", () => {
  const q = reactionQualifier({
    ...base,
    reaction_settled: false,
    reaction_basis: "assumed_report_session",
  });
  assert.equal(q?.mark, "live", "still moving is the more urgent fact");
});

test("nothing measured means nothing to qualify", () => {
  // The row renders no reaction at all here, so a badge beside it would be badging a blank.
  assert.equal(
    reactionQualifier({ ...base, reaction_pct: null, session_change_pct: null }),
    null
  );
  // But a row carrying only the legacy session_change_pct is still a displayed number.
  assert.equal(
    reactionQualifier({
      ...base,
      reaction_pct: null,
      session_change_pct: -1.1,
      reaction_settled: false,
    })?.mark,
    "live"
  );
});

test("settledReactions pools only what may honestly be pooled", () => {
  const prints = [
    { ...base },
    { ...base, reaction_pct: 2.2, reaction_settled: false },
    { ...base, reaction_pct: 3.3, reaction_basis: "assumed_report_session" as const },
    { ...base, reaction_pct: 4.4, reaction_basis: "amc_next_session" as const },
    { ...base, reaction_pct: null, session_change_pct: null },
  ];
  const kept = settledReactions(prints);
  assert.deepEqual(
    kept.map((p) => p.reaction_pct),
    [-4.2, 4.4, null],
    "provisional and assumed are dropped; an unmeasured row carries no claim either way"
  );
  // The point of the exclusion: a still-moving or wrong-session value averaged into "what this
  // company usually does on earnings" launders an unknown into a statistic.
  assert.ok(kept.length < prints.length);
});
