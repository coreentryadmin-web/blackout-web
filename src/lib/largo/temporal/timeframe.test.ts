import { test } from "node:test";
import assert from "node:assert/strict";
import { LARGO_CAPABILITIES } from "@/lib/largo/registry/capability-registry";
import {
  etTimeOnDay,
  formatTemporalBlock,
  isRegularHours,
  nowTimeframe,
  previousWeekday,
  resolveTimeframe,
  sessionCloseMs,
  sessionOpenMs,
  temporalConflicts,
} from "./timeframe";

/** Wed 2026-08-12, 11:00 ET (EDT, UTC-4) → 15:00Z. Mid-session, mid-week, DST active. */
const WED_11ET = Date.UTC(2026, 7, 12, 15, 0);
/** Wed 2026-01-14, 11:00 ET (EST, UTC-5) → 16:00Z. Same wall clock, DST inactive. */
const WED_11ET_WINTER = Date.UTC(2026, 0, 14, 16, 0);

const MIN = 60_000;

test("session boundaries are correct under BOTH DST regimes", () => {
  // A fixed -5/-4 offset would be wrong for half the year, shifting "since open" by an hour
  // exactly when a member is most likely to notice.
  assert.equal(sessionOpenMs(WED_11ET), Date.UTC(2026, 7, 12, 13, 30), "summer open is 13:30Z");
  assert.equal(sessionCloseMs(WED_11ET), Date.UTC(2026, 7, 12, 20, 0), "summer close is 20:00Z");
  assert.equal(sessionOpenMs(WED_11ET_WINTER), Date.UTC(2026, 0, 14, 14, 30), "winter open is 14:30Z");
  assert.equal(sessionCloseMs(WED_11ET_WINTER), Date.UTC(2026, 0, 14, 21, 0), "winter close is 21:00Z");
});

test("regular hours excludes weekends and respects the 09:30/16:00 ET bounds", () => {
  assert.equal(isRegularHours(WED_11ET), true);
  assert.equal(isRegularHours(etTimeOnDay(WED_11ET, 9, 29)), false, "09:29 is pre-open");
  assert.equal(isRegularHours(etTimeOnDay(WED_11ET, 9, 30)), true, "09:30 is open");
  assert.equal(isRegularHours(etTimeOnDay(WED_11ET, 16, 0)), false, "16:00 is closed");
  const sat = Date.UTC(2026, 7, 15, 15, 0);
  assert.equal(isRegularHours(sat), false, "Saturday is never RTH");
});

test("previousWeekday skips the weekend", () => {
  const mon = Date.UTC(2026, 7, 10, 15, 0); // Monday
  const prev = previousWeekday(mon);
  assert.equal(new Date(prev).getUTCDay(), 5, "the day before Monday is Friday");
});

test("no temporal language resolves to the live present", () => {
  for (const q of ["SPX?", "what's the setup on NVDA", "where are the gamma walls"]) {
    const tf = resolveTimeframe(q, WED_11ET);
    assert.equal(tf.kind, "now", q);
    assert.equal(tf.historical, false, `${q} must not be treated as historical`);
  }
});

test("relative minute and hour windows resolve exactly", () => {
  const tf = resolveTimeframe("what changed on SPX in the last 30 minutes", WED_11ET);
  assert.equal(tf.kind, "window");
  assert.equal(tf.toMs, WED_11ET);
  assert.equal(tf.fromMs, WED_11ET - 30 * MIN);
  assert.equal(tf.historical, true);

  const h = resolveTimeframe("how has flow developed over the last 2 hours", WED_11ET);
  assert.equal(h.fromMs, WED_11ET - 2 * 60 * MIN);
});

test("'since open' anchors to 09:30 ET, not to a rolling window", () => {
  const tf = resolveTimeframe("what has moved since the open", WED_11ET);
  assert.equal(tf.fromMs, Date.UTC(2026, 7, 12, 13, 30));
  assert.equal(tf.label, "since the open");
});

test("'last 30 sessions' is a SESSION count, not 30 minutes", () => {
  // Rule ordering matters: a looser minute rule would capture the 30 first and silently answer a
  // 30-session question with a 30-minute window.
  const tf = resolveTimeframe("which signals performed best over the last 30 sessions", WED_11ET);
  assert.equal(tf.kind, "sessions");
  assert.equal(tf.sessions, 30);
  assert.equal(tf.historical, true);
});

test("'yesterday' is the PRIOR session's open-to-close, not a 24h rolling window", () => {
  const tf = resolveTimeframe("compare today's flow with yesterday", WED_11ET);
  assert.equal(tf.kind, "window");
  assert.equal(tf.fromMs, Date.UTC(2026, 7, 11, 13, 30), "prior day 09:30 ET");
  assert.equal(tf.toMs, Date.UTC(2026, 7, 11, 20, 0), "prior day 16:00 ET");
});

test("an explicit clock time resolves to a past instant, never the future", () => {
  const past = resolveTimeframe("what did SPX look like at 10:15", WED_11ET);
  assert.equal(past.kind, "point");
  assert.equal(past.fromMs, Date.UTC(2026, 7, 12, 14, 15));

  // 14:30 ET is AFTER 11:00 ET — it cannot mean later today, so it must mean yesterday.
  const future = resolveTimeframe("what did SPX look like at 2:30pm", WED_11ET);
  assert.equal(future.kind, "point");
  assert.ok(future.fromMs! < WED_11ET, "a time later than now must resolve into the past");
  assert.equal(future.fromMs, Date.UTC(2026, 7, 11, 18, 30), "yesterday 14:30 ET");
});

test("a bare hour without meridiem reads as the afternoon session", () => {
  // "at 3:15" in a trading conversation is 15:15, never 03:15.
  const tf = resolveTimeframe("what happened at 3:15", WED_11ET);
  assert.equal(tf.fromMs, Date.UTC(2026, 7, 11, 19, 15), "15:15 ET yesterday (later than now today)");
});

test("event-anchored questions are historical even though the instant is unresolvable here", () => {
  const tf = resolveTimeframe("what changed since the trade fired", WED_11ET);
  assert.equal(tf.kind, "point");
  assert.equal(tf.fromMs, null, "the instant lives in the ledger, not in the question");
  assert.equal(tf.historical, true, "unresolvable must NOT mean 'treat as now'");
});

test("'since I last asked' is historical with an unresolved start", () => {
  const tf = resolveTimeframe("what changed since I last asked", WED_11ET);
  assert.equal(tf.historical, true);
  assert.equal(tf.fromMs, null, "the start comes from conversation state");
});

test("a bare 'what changed' assumes since-open and SAYS that it assumed", () => {
  // Silently picking an hour would invent a window the member never gave.
  const tf = resolveTimeframe("what changed?", WED_11ET);
  assert.equal(tf.historical, true);
  assert.match(tf.label, /assumed/, "an assumed window must be labelled as assumed");
});

// ── The guard that matters ────────────────────────────────────────────────────────────────────

test("a historical question CONFLICTS with every live-only and as-of source", () => {
  const tf = resolveTimeframe("what did SPX look like at 10:15", WED_11ET);
  const conflicts = temporalConflicts(tf, LARGO_CAPABILITIES);
  assert.ok(conflicts.length > 0, "there must be conflicts to report");
  const ids = conflicts.map((c) => c.capabilityId);
  assert.ok(ids.includes("market.quote"), "get_quote is live_only and cannot answer about 10:15");
  assert.ok(ids.includes("spx.structure"), "as_of sources cannot answer about a past moment either");
  // The point-in-time and event-log sources must NOT be flagged — they are the answer.
  assert.ok(!ids.includes("spx.engine_snapshots"));
  assert.ok(!ids.includes("thermal.regime_events"));
});

test("a present-tense question produces NO conflicts — the fast path stays fast", () => {
  const tf = resolveTimeframe("SPX?", WED_11ET);
  assert.deepEqual(temporalConflicts(tf, LARGO_CAPABILITIES), []);
  assert.equal(formatTemporalBlock(tf, []), "", "no block, no tokens, no latency for simple questions");
});

test("the temporal block tells the model to DECLINE rather than substitute the present", () => {
  const tf = resolveTimeframe("what did SPX look like at 10:15", WED_11ET);
  const block = formatTemporalBlock(tf, temporalConflicts(tf, LARGO_CAPABILITIES));
  assert.match(block, /at 10:15 ET/);
  assert.match(block, /cannot answer/i);
  assert.match(block, /do NOT answer with the current state/i);
});

test("a session-count question tells the model to pass the count, not compute dates", () => {
  const tf = resolveTimeframe("which signals performed best over the last 30 sessions", WED_11ET);
  const block = formatTemporalBlock(tf, temporalConflicts(tf, LARGO_CAPABILITIES));
  assert.match(block, /session\/day count of 30/);
  assert.match(block, /do NOT compute the date range yourself/i);
});

test("an unresolvable start is surfaced as unresolvable, not quietly assumed", () => {
  const tf = resolveTimeframe("what changed since the trade fired", WED_11ET);
  const block = formatTemporalBlock(tf, temporalConflicts(tf, LARGO_CAPABILITIES));
  assert.match(block, /NOT resolvable/i);
  assert.match(block, /say so under \*\*Data\*\*/i);
});

test("resolution never throws on adversarial input", () => {
  for (const q of ["", "at 99:99", "last 999999 minutes", "at :", "since ", "yesterday".repeat(500)]) {
    assert.doesNotThrow(() => resolveTimeframe(q, WED_11ET));
  }
  assert.equal(resolveTimeframe("at 99:99", WED_11ET).kind, "now", "an impossible clock time falls back");
});

test("nowTimeframe is never historical", () => {
  assert.equal(nowTimeframe(WED_11ET).historical, false);
});
