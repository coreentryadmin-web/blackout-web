import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDailyLearningDigestMessage } from "./daily-learning-digest";
import type { NighthawkDebriefReport } from "./debrief-aggregate";

function report(overrides: Partial<NighthawkDebriefReport> = {}): NighthawkDebriefReport {
  return {
    methodology: "current",
    window: { since: "2026-09-18", through: "2026-09-18", days: 1 },
    summary: {
      graded: 4,
      debriefed: 4,
      sessions: 1,
      failure_modes: [],
      legacy_excluded: 0,
      unpinned: 0,
      low_n: true,
    },
    by_conviction: [],
    by_tier: [],
    gate_validation: { blocked_value: [], published_mirror: [] },
    target_atr_distribution: { rows_n: 0, pinned_n: 0, histogram: [], median: null, over_gate_n: 0 },
    improvement_queue: [],
    available: true,
    ...overrides,
  };
}

test("buildDailyLearningDigestMessage: unavailable report returns null, never a misleading empty digest", () => {
  assert.equal(buildDailyLearningDigestMessage(report({ available: false })), null);
});

test("buildDailyLearningDigestMessage: title carries the window's through-date", () => {
  const msg = buildDailyLearningDigestMessage(report({ window: { since: "2026-09-17", through: "2026-09-18", days: 1 } }));
  assert.equal(msg!.title, "Night Hawk Legacy — Daily Learning Digest (2026-09-18)");
});

test("buildDailyLearningDigestMessage: body reports graded/debriefed/sessions and the LOW-N badge when set", () => {
  const msg = buildDailyLearningDigestMessage(report());
  assert.match(msg!.body, /4 graded, 4 debriefed across 1 session\(s\)/);
  assert.match(msg!.body, /LOW-N/);
});

test("buildDailyLearningDigestMessage: no LOW-N badge when summary.low_n is false", () => {
  const msg = buildDailyLearningDigestMessage(
    report({ summary: { graded: 40, debriefed: 40, sessions: 10, failure_modes: [], legacy_excluded: 0, unpinned: 0, low_n: false } })
  );
  assert.doesNotMatch(msg!.body, /LOW-N/);
});

test("buildDailyLearningDigestMessage: top failure modes appear in the body, ordered as given", () => {
  const msg = buildDailyLearningDigestMessage(
    report({
      summary: {
        graded: 10,
        debriefed: 10,
        sessions: 2,
        failure_modes: [
          { tag: "clean_win", n: 4 },
          { tag: "stopped_normal", n: 3 },
        ],
        legacy_excluded: 0,
        unpinned: 0,
        low_n: false,
      },
    })
  );
  assert.match(msg!.body, /Top failure mode\(s\): clean_win \(4\), stopped_normal \(3\)/);
});

test("buildDailyLearningDigestMessage: unpinned rows get an explicit callout when present", () => {
  const msg = buildDailyLearningDigestMessage(
    report({ summary: { graded: 5, debriefed: 3, sessions: 1, failure_modes: [], legacy_excluded: 0, unpinned: 2, low_n: true } })
  );
  assert.match(msg!.body, /2 graded row\(s\) not yet debriefed/);
});

test("buildDailyLearningDigestMessage: no improvement-queue field when the queue is empty", () => {
  const msg = buildDailyLearningDigestMessage(report({ improvement_queue: [] }));
  assert.equal(msg!.fields.find((f) => f.name.startsWith("Improvement queue")), undefined);
});

test("buildDailyLearningDigestMessage: improvement-queue field lists each item's signal/evidence/suggestion, capped at 3", () => {
  const msg = buildDailyLearningDigestMessage(
    report({
      improvement_queue: [
        { signal: "wrong_direction dominant", evidence: { n: 12, delta: 18 }, suggestion: "review confirmation gate", low_n: false },
        { signal: "pulled_wrongly dominant", evidence: { n: 4, delta: null }, suggestion: null, low_n: true },
        { signal: "third", evidence: { n: 5, delta: 2 }, suggestion: "s3", low_n: false },
        { signal: "fourth (dropped, over cap)", evidence: { n: 1, delta: null }, suggestion: null, low_n: false },
      ],
    })
  );
  const field = msg!.fields.find((f) => f.name.startsWith("Improvement queue"))!;
  assert.equal(field.name, "Improvement queue (4 item(s))");
  assert.match(field.value, /wrong_direction dominant \(n=12, delta=18pt\): review confirmation gate/);
  assert.match(field.value, /pulled_wrongly dominant \(n=4\) \[low-n\]/);
  assert.doesNotMatch(field.value, /fourth \(dropped, over cap\)/);
});

test("buildDailyLearningDigestMessage: gate-blocked-value field quotes each line's own pre-built summary sentence verbatim, only when a rate exists", () => {
  const msg = buildDailyLearningDigestMessage(
    report({
      gate_validation: {
        blocked_value: [
          {
            gate: "band_detached",
            blocked_n: 10,
            graded_n: 8,
            ungraded_n: 2,
            would_have_won: 3,
            decided_n: 8,
            would_have_won_rate_pct: 37.5,
            unfilled_n: 0,
            low_n: false,
            summary: "band_detached blocked 10, 8 decided, 3 would have won (37.5%)",
          },
          {
            gate: "no_counterfactuals_yet",
            blocked_n: 5,
            graded_n: 0,
            ungraded_n: 5,
            would_have_won: 0,
            decided_n: 0,
            would_have_won_rate_pct: null,
            unfilled_n: 0,
            low_n: true,
            summary: "no_counterfactuals_yet blocked 5, none graded yet",
          },
        ],
        published_mirror: [],
      },
    })
  );
  const field = msg!.fields.find((f) => f.name === "Gate-blocked value (rejected winners)")!;
  assert.match(field.value, /band_detached blocked 10, 8 decided, 3 would have won \(37\.5%\)/);
  assert.doesNotMatch(field.value, /no_counterfactuals_yet/, "a line with no rate yet (all ungraded) is excluded, not printed with a null rate");
});

test("buildDailyLearningDigestMessage: an entirely quiet, clean report still returns a message (never null just because nothing needs fixing)", () => {
  const msg = buildDailyLearningDigestMessage(
    report({ summary: { graded: 20, debriefed: 20, sessions: 5, failure_modes: [], legacy_excluded: 0, unpinned: 0, low_n: false } })
  );
  assert.notEqual(msg, null);
  assert.equal(msg!.fields.length, 0, "no queue items and no blocked-value lines -- a genuinely clean window has no fields, not fabricated ones");
});
