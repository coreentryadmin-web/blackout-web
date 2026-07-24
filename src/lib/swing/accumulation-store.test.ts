import { test } from "node:test";
import assert from "node:assert/strict";
import {
  meetsPersistence,
  observeSwingCandidate,
  fetchWatchEligible,
  promoteSwingCandidate,
  fromStoreDir,
  MIN_PERSISTENCE_SESSIONS,
  type SwingAccumAccessors,
} from "./accumulation-store.ts";
import type { SwingAccumRow } from "../db.ts";

// In-memory fake of the PR-10 accessors, mirroring the upsert's distinct-day semantics: a +1 distinct day
// ONLY when the session day actually changes (repeats within a day don't count). Lets us prove the
// persistence gate without a live Postgres (raw TCP is blocked in the sandbox anyway).
function makeFakeAccessors() {
  const rows = new Map<string, SwingAccumRow>();
  const now = () => new Date("2026-07-24T21:00:00Z").toISOString();
  const accessors: SwingAccumAccessors = {
    async upsertSwingAccum(a) {
      const key = `${a.ticker.toUpperCase()}|${a.direction}`;
      const cur = rows.get(key);
      if (!cur) {
        rows.set(key, {
          ticker: a.ticker.toUpperCase(),
          direction: a.direction,
          observation_count: 1,
          distinct_session_days: 1,
          last_session_day: a.session_day,
          phases_seen: [a.phase],
          signal_kinds: [...new Set(a.signal_kinds ?? [])],
          promoted_position_id: null,
          first_seen_at: now(),
          last_seen_at: now(),
        });
      } else {
        cur.observation_count += 1;
        if (cur.last_session_day !== a.session_day) cur.distinct_session_days += 1;
        cur.last_session_day = a.session_day;
        if (!(cur.phases_seen ?? []).includes(a.phase)) cur.phases_seen = [...(cur.phases_seen ?? []), a.phase];
        // Deduped union of the SCREEN provenance (signal kinds) — mirrors the PR-10 upsert.
        for (const k of a.signal_kinds ?? []) {
          if (!(cur.signal_kinds ?? []).includes(k)) cur.signal_kinds = [...(cur.signal_kinds ?? []), k];
        }
        cur.last_seen_at = now();
      }
    },
    async fetchAccumulating(minSessionDays = 1, limit = 500) {
      return [...rows.values()]
        .filter((r) => r.promoted_position_id == null && r.distinct_session_days >= minSessionDays)
        .slice(0, limit);
    },
    async markAccumPromoted(ticker, direction, positionId) {
      const cur = rows.get(`${ticker.toUpperCase()}|${direction}`);
      if (cur) cur.promoted_position_id = positionId;
    },
    async fadeStaleAccum() {
      return 0;
    },
  };
  return { accessors, rows };
}

test("meetsPersistence: default (cross-session) — 1 session below the bar, 2 clears it", () => {
  assert.equal(MIN_PERSISTENCE_SESSIONS, 2);
  assert.equal(meetsPersistence({ distinct_session_days: 1 }), false);
  assert.equal(meetsPersistence({ distinct_session_days: 2 }), true);
  assert.equal(meetsPersistence({ distinct_session_days: 3 }), true);
  // Non-finite → false (honest, never a truthy accident).
  assert.equal(meetsPersistence({ distinct_session_days: NaN as unknown as number }), false);
});

test("meetsPersistence: cross-session archetypes still require 2 distinct sessions (critique #3)", () => {
  // FLOW_ACCUMULATION with a single (even multi-print) session is NOT promotable — a build spans days.
  assert.equal(
    meetsPersistence({ distinct_session_days: 1, observation_count: 3, signal_kinds: ["FLOW", "STRUCTURE"] }, "FLOW_ACCUMULATION"),
    false,
    "one session never clears a cross-session archetype, even with corroborating kinds",
  );
  assert.equal(
    meetsPersistence({ distinct_session_days: 2, observation_count: 2, signal_kinds: ["FLOW"] }, "FLOW_ACCUMULATION"),
    true,
    "two distinct sessions clears the cross-session gate",
  );
  // BREAKOUT/PULLBACK/MEAN_REVERSION/SECTOR_ROTATION behave the same (all cross-session).
  for (const a of ["BREAKOUT", "PULLBACK_CONTINUATION", "MEAN_REVERSION", "SECTOR_ROTATION"] as const) {
    assert.equal(meetsPersistence({ distinct_session_days: 1, signal_kinds: ["FLOW", "STRUCTURE"] }, a), false, `${a} needs 2 sessions`);
    assert.equal(meetsPersistence({ distinct_session_days: 2, signal_kinds: ["FLOW"] }, a), true, `${a} clears at 2 sessions`);
  }
});

test("meetsPersistence: event archetypes clear on 1 session + corroboration, NOT on a lone print (anti-lone-print)", () => {
  for (const a of ["EVENT_DRIVEN", "POST_EARNINGS_DRIFT", "FAILED_BREAKDOWN"] as const) {
    // 1 session + 2 distinct signal kinds (a flow print AND a structure/catalyst signal) → corroborated → promoted.
    assert.equal(
      meetsPersistence({ distinct_session_days: 1, observation_count: 2, signal_kinds: ["FLOW", "CATALYST"] }, a),
      true,
      `${a}: 1 session + 2 distinct signal kinds promotes`,
    );
    // 1 session + a single lone print (one signal kind, one observation) → NOT corroborated → NOT promoted.
    assert.equal(
      meetsPersistence({ distinct_session_days: 1, observation_count: 1, signal_kinds: ["FLOW"] }, a),
      false,
      `${a}: a lone print never promotes (anti-lone-print invariant holds)`,
    );
    // A 2nd session is itself independent corroboration → promoted even with a single signal kind.
    assert.equal(
      meetsPersistence({ distinct_session_days: 2, observation_count: 2, signal_kinds: ["FLOW"] }, a),
      true,
      `${a}: a 2nd session corroborates on its own`,
    );
    // Two prints of the SAME kind in one session are NOT two independent signals → still a lone-print class.
    assert.equal(
      meetsPersistence({ distinct_session_days: 1, observation_count: 5, signal_kinds: ["FLOW"] }, a),
      false,
      `${a}: repeated same-kind prints are not corroboration`,
    );
  }
});

test("meetsPersistence: corroboration counts distinct signal KINDS, not cadence PHASES (fix 2026-07-24)", () => {
  // The load-bearing regression this fix closes: an event candidate seen with the SAME signal kind (FLOW)
  // repeated across two CADENCE phases (POST_CLOSE then MIDDAY) is ONE independent signal — a lone print
  // spread across the day — and must NOT corroborate. `phases_seen` carries the cadence phases; corroboration
  // now reads `signal_kinds` (screen provenance), so those two FLOW sightings stay uncorroborated.
  for (const a of ["EVENT_DRIVEN", "POST_EARNINGS_DRIFT", "FAILED_BREAKDOWN"] as const) {
    assert.equal(
      // Two cadence windows, ONE signal kind → not corroborated (this used to FALSELY pass when we counted phases).
      meetsPersistence({ distinct_session_days: 1, observation_count: 2, signal_kinds: ["FLOW"] }, a),
      false,
      `${a}: one kind re-seen across cadence windows is NOT corroboration`,
    );
    assert.equal(
      // A genuinely independent 2nd kind (a grounded CATALYST alongside the FLOW print) → corroborated.
      meetsPersistence({ distinct_session_days: 1, observation_count: 2, signal_kinds: ["FLOW", "CATALYST"] }, a),
      true,
      `${a}: a second independent signal KIND corroborates`,
    );
  }
  // A stale `phases_seen` full of cadence entries can never masquerade as corroboration now that the predicate
  // ignores it — a legacy row that only carried cadence phases (empty signal_kinds) needs a real 2nd session.
  assert.equal(
    meetsPersistence({ distinct_session_days: 1, observation_count: 4, signal_kinds: [] }, "EVENT_DRIVEN"),
    false,
    "empty signal_kinds (legacy cadence-only row) is never self-corroborating",
  );
});

test("fromStoreDir converts lowercase table direction back to PlayDirection", () => {
  assert.equal(fromStoreDir("long"), "LONG");
  assert.equal(fromStoreDir("short"), "SHORT");
});

test("a 1-session candidate stays below persistence; a 2-distinct-session candidate clears it", async () => {
  const { accessors } = makeFakeAccessors();

  // Session 1: first sighting.
  await observeSwingCandidate(accessors, {
    ticker: "NVDA",
    direction: "LONG",
    sessionDay: "2026-07-23",
    phase: "POST_CLOSE",
  });
  // A repeat WITHIN the same session must NOT add a distinct day.
  await observeSwingCandidate(accessors, {
    ticker: "NVDA",
    direction: "LONG",
    sessionDay: "2026-07-23",
    phase: "MIDDAY",
  });

  let eligible = await fetchWatchEligible(accessors);
  assert.equal(eligible.length, 0, "one distinct session day is below the WATCH bar");

  // Session 2: a NEW distinct session day → now persisted.
  await observeSwingCandidate(accessors, {
    ticker: "NVDA",
    direction: "LONG",
    sessionDay: "2026-07-24",
    phase: "POST_CLOSE",
  });

  eligible = await fetchWatchEligible(accessors);
  assert.equal(eligible.length, 1, "two distinct session days clears the WATCH bar");
  assert.equal(eligible[0].ticker, "NVDA");
  assert.equal(eligible[0].direction, "LONG"); // converted back from the lowercase store dir
  assert.equal(eligible[0].distinctSessionDays, 2);
  assert.equal(eligible[0].observationCount, 3); // 3 sightings, only 2 distinct days
  assert.deepEqual([...eligible[0].phasesSeen].sort(), ["MIDDAY", "POST_CLOSE"]);
});

test("fetchWatchEligible archetypeOf: a corroborated 1-session event candidate surfaces; a lone print does not", async () => {
  const { accessors } = makeFakeAccessors();

  // EVENT name: 1 session, two DISTINCT signal KINDS (a flow print AND a grounded catalyst) → corroborated.
  // The cadence phase is the same POST_CLOSE both times — corroboration comes from the KINDS, not the phase.
  await observeSwingCandidate(accessors, { ticker: "MRNA", direction: "LONG", sessionDay: "2026-07-24", phase: "POST_CLOSE", signalKinds: ["FLOW"] });
  await observeSwingCandidate(accessors, { ticker: "MRNA", direction: "LONG", sessionDay: "2026-07-24", phase: "POST_CLOSE", signalKinds: ["CATALYST"] });
  // EVENT name: 1 session, a single lone print (one FLOW kind, no corroboration).
  await observeSwingCandidate(accessors, { ticker: "PLTR", direction: "LONG", sessionDay: "2026-07-24", phase: "POST_CLOSE", signalKinds: ["FLOW"] });

  // Without a resolver (conservative default) neither clears — both are single-session.
  assert.equal((await fetchWatchEligible(accessors)).length, 0, "default gate keeps both off (1 session)");

  // With an event-classifying resolver: the corroborated one promotes, the lone print does not.
  const eligible = await fetchWatchEligible(accessors, MIN_PERSISTENCE_SESSIONS, 500, () => "EVENT_DRIVEN");
  assert.deepEqual(eligible.map((c) => c.ticker).sort(), ["MRNA"]);
  assert.deepEqual([...eligible[0].signalKinds].sort(), ["CATALYST", "FLOW"], "the corroborating signal kinds are surfaced on the watch candidate");
});

test("promoted candidates drop off the WATCH-eligible rail", async () => {
  const { accessors } = makeFakeAccessors();
  await observeSwingCandidate(accessors, { ticker: "AMD", direction: "SHORT", sessionDay: "2026-07-22", phase: "POST_CLOSE" });
  await observeSwingCandidate(accessors, { ticker: "AMD", direction: "SHORT", sessionDay: "2026-07-23", phase: "POST_CLOSE" });
  assert.equal((await fetchWatchEligible(accessors)).length, 1);

  await promoteSwingCandidate(accessors, "AMD", "SHORT", 42);
  assert.equal((await fetchWatchEligible(accessors)).length, 0, "promoted row no longer counts as a fresh candidate");
});
