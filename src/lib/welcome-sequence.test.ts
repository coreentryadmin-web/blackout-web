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

  const update = queries.find((q) => q.sql.includes("UPDATE welcome_sequence_state"));
  assert.ok(update, "expected an UPDATE after the send");
  assert.equal(update?.params[1], 1, "steps_sent should advance to 1");
  assert.notEqual(update?.params[2], null, "next_send_at should be set (step 2 exists)");
  assert.equal(update?.params[3], null, "completed_at should stay null (not the last step)");
});

test("startWelcomeSequence is idempotent — a duplicate webhook delivery sends nothing", async () => {
  const { deps, queries, sent } = fakeDeps({ insertRowCount: 0 }); // ON CONFLICT DO NOTHING already happened
  await startWelcomeSequence({ userId: "user_1", email: "trader@example.com" }, deps);

  assert.equal(sent.length, 0, "must not send when the row already existed");
  const update = queries.find((q) => q.sql.includes("UPDATE welcome_sequence_state"));
  assert.equal(update, undefined, "must not update when the insert was a no-op");
});

test("startWelcomeSequence does not advance steps_sent when the send fails", async () => {
  const { deps, queries, sent } = fakeDeps({ insertRowCount: 1, sendOk: false });
  await startWelcomeSequence({ userId: "user_1", email: "trader@example.com" }, deps);

  assert.equal(sent.length, 1, "still attempts the send");
  const update = queries.find((q) => q.sql.includes("UPDATE welcome_sequence_state"));
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
    selectRows: [{ user_id: "user_1", email: "trader@example.com", first_name: "Sam", steps_sent: 1 }],
  });
  const result = await processDueWelcomeSequenceSteps(200, deps);

  assert.deepEqual(result, { processed: 1, sent: 1, failed: 0 });
  assert.equal(sent[0].subject, WELCOME_SEQUENCE[1].build({ email: "trader@example.com", firstName: "Sam" }).subject, "sends step 2 for steps_sent=1");

  const update = queries.find((q) => q.sql.includes("UPDATE welcome_sequence_state"));
  assert.equal(update?.params[1], 2, "steps_sent advances to 2");
});

test("processDueWelcomeSequenceSteps marks the row complete after the final step", async () => {
  const lastIndex = WELCOME_SEQUENCE.length - 1;
  const { deps, queries } = fakeDeps({
    sendOk: true,
    selectRows: [{ user_id: "user_1", email: "trader@example.com", first_name: null, steps_sent: lastIndex }],
  });
  await processDueWelcomeSequenceSteps(200, deps);

  const update = queries.find((q) => q.sql.includes("UPDATE welcome_sequence_state"));
  assert.equal(update?.params[1], lastIndex + 1, "steps_sent reaches the full count");
  assert.equal(update?.params[2], null, "next_send_at is null — nothing left to schedule");
  assert.notEqual(update?.params[3], null, "completed_at is set");
});

test("processDueWelcomeSequenceSteps leaves state untouched on a send failure (so the next run retries)", async () => {
  const { deps, queries } = fakeDeps({
    sendOk: false,
    selectRows: [{ user_id: "user_1", email: "trader@example.com", first_name: null, steps_sent: 0 }],
  });
  const result = await processDueWelcomeSequenceSteps(200, deps);

  assert.deepEqual(result, { processed: 1, sent: 0, failed: 1 });
  const update = queries.find((q) => q.sql.includes("UPDATE welcome_sequence_state"));
  assert.equal(update, undefined, "no state update on a failed send — must retry, not skip or corrupt state");
});

test("processDueWelcomeSequenceSteps returns zeros when nothing is due", async () => {
  const { deps } = fakeDeps({ selectRows: [] });
  const result = await processDueWelcomeSequenceSteps(200, deps);
  assert.deepEqual(result, { processed: 0, sent: 0, failed: 0 });
});
