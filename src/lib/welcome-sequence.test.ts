import assert from "node:assert/strict";
import { test } from "node:test";
import { processDueWelcomeSequenceSteps, startWelcomeSequence } from "./welcome-sequence.ts";
import { WELCOME_SEQUENCE } from "./email/templates/welcome-sequence.ts";

function fakeDeps(overrides: {
  configured?: boolean;
  insertRowCount?: number; // controls the ON CONFLICT insert's RETURNING rowCount
  sendOk?: boolean;
  selectRows?: unknown[];
}) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const sent: { to: string; subject: string }[] = [];
  const deps = {
    dbConfigured: () => overrides.configured ?? true,
    dbQuery: (async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      if (sql.includes("INSERT INTO welcome_sequence_state")) {
        const rc = overrides.insertRowCount ?? 1;
        return { rows: rc > 0 ? [{ id: 1 }] : [], rowCount: rc };
      }
      if (sql.includes("SELECT user_id, email, first_name, steps_sent")) {
        return { rows: overrides.selectRows ?? [] };
      }
      return { rows: [], rowCount: 1 };
    }) as never,
    sendEmail: (async (input: { to: string; subject: string }) => {
      sent.push({ to: input.to, subject: input.subject });
      return overrides.sendOk === false ? { ok: false, error: "send_failed" } : { ok: true, id: "email_1" };
    }) as never,
    syncResendContact: (async () => undefined) as never,
  };
  return { deps, queries, sent };
}

test("startWelcomeSequence sends step 1 and schedules step 2 on a fresh signup", async () => {
  const { deps, queries, sent } = fakeDeps({ insertRowCount: 1, sendOk: true });
  await startWelcomeSequence({ userId: "user_1", email: "trader@example.com", firstName: "Sam" }, deps);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "trader@example.com");
  assert.equal(sent[0].subject, WELCOME_SEQUENCE[0].build({ email: "trader@example.com", firstName: "Sam" }).subject);

  const update = queries.find((q) => q.sql.includes("UPDATE welcome_sequence_state") && q.sql.includes("SET steps_sent"));
  assert.ok(update, "expected an UPDATE after the send");
  assert.equal(update?.params[1], 1, "steps_sent should advance to 1");
  assert.notEqual(update?.params[2], null, "next_send_at should be set (step 2 exists)");
  assert.equal(update?.params[3], null, "completed_at should stay null (not the last step)");
});

test("startWelcomeSequence is idempotent — a duplicate webhook delivery sends nothing", async () => {
  const { deps, queries, sent } = fakeDeps({ insertRowCount: 0 }); // ON CONFLICT DO NOTHING already happened
  await startWelcomeSequence({ userId: "user_1", email: "trader@example.com" }, deps);

  assert.equal(sent.length, 0, "must not send when the row already existed");
  const update = queries.find((q) => q.sql.includes("UPDATE welcome_sequence_state") && q.sql.includes("SET steps_sent"));
  assert.equal(update, undefined, "must not update when the insert was a no-op");
});

test("startWelcomeSequence does not advance steps_sent when the send fails", async () => {
  const { deps, queries, sent } = fakeDeps({ insertRowCount: 1, sendOk: false });
  await startWelcomeSequence({ userId: "user_1", email: "trader@example.com" }, deps);

  assert.equal(sent.length, 1, "still attempts the send");
  const update = queries.find((q) => q.sql.includes("UPDATE welcome_sequence_state") && q.sql.includes("SET steps_sent"));
  assert.equal(update?.params[1], 0, "steps_sent stays 0 so the cron retries step 1");
});

test("startWelcomeSequence is a no-op when the DB is not configured", async () => {
  const { deps, queries, sent } = fakeDeps({ configured: false });
  await startWelcomeSequence({ userId: "user_1", email: "trader@example.com" }, deps);

  assert.equal(sent.length, 0);
  assert.equal(queries.length, 0);
});

test("processDueWelcomeSequenceSteps sends the next step and advances state", async () => {
  const { deps, queries, sent } = fakeDeps({
    sendOk: true,
    selectRows: [{ user_id: "user_1", email: "trader@gmail.com", first_name: "Sam", steps_sent: 1 }],
  });
  const result = await processDueWelcomeSequenceSteps(200, deps);

  assert.deepEqual(result, { processed: 1, sent: 1, failed: 0 });
  assert.equal(sent[0].subject, WELCOME_SEQUENCE[1].build({ email: "trader@gmail.com", firstName: "Sam" }).subject, "sends step 2 for steps_sent=1");

  const update = queries.find((q) => q.sql.includes("UPDATE welcome_sequence_state") && q.sql.includes("SET steps_sent"));
  assert.equal(update?.params[1], 2, "steps_sent advances to 2");
});

test("processDueWelcomeSequenceSteps marks the row complete after the final step", async () => {
  const lastIndex = WELCOME_SEQUENCE.length - 1;
  const { deps, queries } = fakeDeps({
    sendOk: true,
    selectRows: [{ user_id: "user_1", email: "trader@gmail.com", first_name: null, steps_sent: lastIndex }],
  });
  await processDueWelcomeSequenceSteps(200, deps);

  const update = queries.find((q) => q.sql.includes("UPDATE welcome_sequence_state") && q.sql.includes("SET steps_sent"));
  assert.equal(update?.params[1], lastIndex + 1, "steps_sent reaches the full count");
  assert.equal(update?.params[2], null, "next_send_at is null — nothing left to schedule");
  assert.notEqual(update?.params[3], null, "completed_at is set");
});

test("processDueWelcomeSequenceSteps leaves state untouched on a send failure (so the next run retries)", async () => {
  const { deps, queries } = fakeDeps({
    sendOk: false,
    selectRows: [{ user_id: "user_1", email: "trader@gmail.com", first_name: null, steps_sent: 0 }],
  });
  const result = await processDueWelcomeSequenceSteps(200, deps);

  assert.deepEqual(result, { processed: 1, sent: 0, failed: 1 });
  const update = queries.find((q) => q.sql.includes("UPDATE welcome_sequence_state") && q.sql.includes("SET steps_sent"));
  assert.equal(update, undefined, "no state update on a failed send — must retry, not skip or corrupt state");
});

test("processDueWelcomeSequenceSteps returns zeros when nothing is due", async () => {
  const { deps } = fakeDeps({ selectRows: [] });
  const result = await processDueWelcomeSequenceSteps(200, deps);
  assert.deepEqual(result, { processed: 0, sent: 0, failed: 0 });
});

// ── Legacy audit/test-harness rows ─────────────────────────────────────────────────────────
// The Clerk webhook gate (isInternalAuditEmail, added 2026-08-28) only stops NEW audit accounts
// from entering this table — rows from the ~30 ad-hoc harnesses that predate it are already
// sitting here, and without a check in the cron loop itself, this hourly job would retry each
// one forever (a failed send deliberately doesn't advance next_send_at), burning a real Resend
// 422 every run until the 7-day staleness cutoff.

test("processDueWelcomeSequenceSteps retires a legacy audit-account row without attempting a send", async () => {
  const { deps, sent, queries } = fakeDeps({
    selectRows: [{ user_id: "user_audit", email: "helix-interaction-audit@example.com", first_name: null, steps_sent: 1 }],
  });
  const result = await processDueWelcomeSequenceSteps(200, deps);

  assert.equal(sent.length, 0, "must never attempt to send to a recognized audit account");
  assert.deepEqual(result, { processed: 1, sent: 0, failed: 0 }, "resolved, not a failure — a skip is not a bounce");

  const update = queries.find(
    (q) => q.sql.includes("UPDATE welcome_sequence_state") && q.sql.includes("WHERE user_id = $1")
  );
  assert.ok(update, "the row must be marked complete so it never resurfaces");
  assert.match(update!.sql, /completed_at = NOW\(\)/);
  assert.match(update!.sql, /next_send_at = NULL/);
  assert.deepEqual(update?.params, ["user_audit"]);
});

test("processDueWelcomeSequenceSteps still sends to a real member sharing no audit pattern", async () => {
  const { deps, sent } = fakeDeps({
    sendOk: true,
    selectRows: [{ user_id: "user_1", email: "trader@gmail.com", first_name: "Sam", steps_sent: 1 }],
  });
  const result = await processDueWelcomeSequenceSteps(200, deps);

  assert.equal(sent.length, 1, "a real member's email must not be caught by the audit-account skip");
  assert.deepEqual(result, { processed: 1, sent: 1, failed: 0 });
});

// ── Staleness cutoff ────────────────────────────────────────────────────────────────────────
// The cron was never scheduled in production until 2026-08-08, so on its first real run every
// existing row was due at once. Without a cutoff that flushes the entire backlog as live mail:
// stale, out-of-context welcome emails to the existing member base, which is exactly the kind of
// burst that drives spam complaints — the one metric Gmail/Yahoo suspend bulk senders over.

test("retires rows more than the lateness window past due, before selecting work", async () => {
  const { deps, queries } = fakeDeps({ selectRows: [] });
  await processDueWelcomeSequenceSteps(200, deps);

  const retire = queries.find((q) => q.sql.includes("UPDATE welcome_sequence_state") && q.sql.includes("interval"));
  assert.ok(retire, "a retirement UPDATE must run");
  assert.match(retire!.sql, /completed_at = NOW\(\)/, "stale rows are completed, not left pending");
  assert.match(retire!.sql, /next_send_at = NULL/, "and unscheduled so they cannot resurface");
  assert.match(retire!.sql, /next_send_at < NOW\(\) - /, "only rows PAST the window are retired");
  assert.match(retire!.sql, /completed_at IS NULL/, "already-finished rows are left alone");
  assert.deepEqual(retire!.params, ["7"], "7-day window ≈ 3 step gaps");

  const select = queries.findIndex((q) => q.sql.includes("SELECT user_id, email, first_name, steps_sent"));
  const retireIdx = queries.indexOf(retire!);
  assert.ok(retireIdx < select, "retirement must run BEFORE the due-work select, or stale rows still send");
});

test("retiring stale rows never sends mail", async () => {
  // The whole point: a row past the window exits the drip silently.
  const { deps, sent } = fakeDeps({ selectRows: [] });
  const res = await processDueWelcomeSequenceSteps(200, deps);
  assert.equal(sent.length, 0);
  assert.equal(res.sent, 0);
});

test("rows inside the window still send normally", async () => {
  // Guard against the cutoff being over-broad — a few missed hourly runs must still deliver.
  const { deps, sent } = fakeDeps({
    selectRows: [{ user_id: "user_1", email: "trader@gmail.com", first_name: "Sam", steps_sent: 1 }],
    sendOk: true,
  });
  const res = await processDueWelcomeSequenceSteps(200, deps);
  assert.equal(res.sent, 1, "a due row inside the window is still delivered");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, WELCOME_SEQUENCE[1].build({ email: "trader@gmail.com", firstName: "Sam" }).subject);
});
