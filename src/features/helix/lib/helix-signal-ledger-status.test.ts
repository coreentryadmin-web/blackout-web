import { test } from "node:test";
import assert from "node:assert/strict";
import { CRON_JOB_BY_KEY } from "@/lib/cron-registry";
import {
  CRON_RUN_OBSERVATION_DAYS,
  SIGNAL_LEDGER_WRITER_JOB_KEY,
  signalLedgerCopy,
  signalLedgerStatus,
} from "./helix-signal-ledger-status";

const RAN = "2026-08-23T13:45:00.000Z";

test("rows present is `recording` regardless of what the run history says", () => {
  // Real data outranks the run log. A retention-pruned history must never be able to contradict
  // rows that plainly exist.
  assert.deepEqual(signalLedgerStatus({ rowCount: 1, lastWriterRunAt: null }), {
    state: "recording",
  });
  assert.deepEqual(signalLedgerStatus({ rowCount: 50, lastWriterRunAt: RAN }), {
    state: "recording",
  });
});

test("empty ledger + an observed writer run is `awaiting_firings` — the only true 'no firings yet'", () => {
  const v = signalLedgerStatus({ rowCount: 0, lastWriterRunAt: RAN });
  assert.equal(v.state, "awaiting_firings");
  assert.equal(v.state === "awaiting_firings" ? v.lastWriterRunAt : null, RAN);
});

test("empty ledger + no observed run is `no_writer_observed` — the live production state", () => {
  // helix-signal-outcomes is registered in cron-registry.ts and absent from the deployed manifest,
  // so nothing has ever written a row. This is the state the panel used to describe as a quiet
  // session.
  const v = signalLedgerStatus({ rowCount: 0, lastWriterRunAt: null });
  assert.equal(v.state, "no_writer_observed");
  assert.equal(
    v.state === "no_writer_observed" ? v.observationWindowDays : null,
    CRON_RUN_OBSERVATION_DAYS
  );
});

test("an unusable timestamp is treated as no observation, never as a run", () => {
  // `undefined`, empty string and unparseable text all mean "we did not learn of a run". Coercing
  // any of them into an `awaiting_firings` verdict would assert a writer that was never seen —
  // the same fabrication in the opposite direction.
  for (const bad of [undefined, null, "", "   ", "not-a-date", "NaN"]) {
    const v = signalLedgerStatus({ rowCount: 0, lastWriterRunAt: bad });
    assert.equal(v.state, "no_writer_observed", `${JSON.stringify(bad)} must not imply a run`);
  }
});

test("the verdict is bounded by the observation window, and says so", () => {
  const v = signalLedgerStatus({ rowCount: 0, lastWriterRunAt: null, observationWindowDays: 7 });
  assert.equal(v.state === "no_writer_observed" ? v.observationWindowDays : null, 7);
  const copy = signalLedgerCopy(v)!;
  assert.match(copy.description, /last 7 days/);
  // It must never claim "never" — cron_job_runs prunes its own history, so the evidence cannot
  // support that word.
  assert.doesNotMatch(copy.description, /never/i);
});

test("`recording` has no copy — the panel shows rows instead of a message", () => {
  assert.equal(signalLedgerCopy({ state: "recording" }), null);
});

test("the two empty states say DIFFERENT things, and neither claims a quiet session", () => {
  const waiting = signalLedgerCopy({ state: "awaiting_firings", lastWriterRunAt: RAN })!;
  const missing = signalLedgerCopy({ state: "no_writer_observed", observationWindowDays: 30 })!;
  assert.notEqual(waiting.title, missing.title);
  assert.notEqual(waiting.description, missing.description);

  // The regression that motivated all of this: the copy asserted that nothing had fired, from a
  // row count that cannot see firings. Neither state may say that again.
  for (const c of [waiting, missing]) {
    assert.doesNotMatch(c.description, /this session/i);
  }
  // And the missing-writer copy must actively deny the wrong reading, since the radars on the same
  // page are showing firings while this panel is empty.
  assert.match(missing.description, /Signals still fire/i);
  assert.match(missing.description, /not being (persisted|kept)/i);
});

test("the writer key resolves against the real cron registry — it cannot drift into a typo", () => {
  // Asserting the string against itself would prove nothing. What matters is that the key this
  // module probes `cron_job_runs` for is a key some cron actually logs under: a typo here would
  // return no runs forever and report `no_writer_observed` on a perfectly healthy writer — a
  // fabricated defect, which is the same failure as a fabricated measurement.
  const job = CRON_JOB_BY_KEY[SIGNAL_LEDGER_WRITER_JOB_KEY];
  assert.ok(job, `${SIGNAL_LEDGER_WRITER_JOB_KEY} must exist in CRON_JOBS`);
  // And it must be the route that runs BOTH record and grade — its absence empties the ledger
  // entirely rather than merely stalling grading.
  assert.equal(job.path, "/api/cron/helix-signal-outcomes");
});
