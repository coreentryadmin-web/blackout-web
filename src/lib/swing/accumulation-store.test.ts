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
          promoted_position_id: null,
          first_seen_at: now(),
          last_seen_at: now(),
        });
      } else {
        cur.observation_count += 1;
        if (cur.last_session_day !== a.session_day) cur.distinct_session_days += 1;
        cur.last_session_day = a.session_day;
        if (!(cur.phases_seen ?? []).includes(a.phase)) cur.phases_seen = [...(cur.phases_seen ?? []), a.phase];
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

test("meetsPersistence: 1 session below the bar, 2 clears it", () => {
  assert.equal(MIN_PERSISTENCE_SESSIONS, 2);
  assert.equal(meetsPersistence({ distinct_session_days: 1 }), false);
  assert.equal(meetsPersistence({ distinct_session_days: 2 }), true);
  assert.equal(meetsPersistence({ distinct_session_days: 3 }), true);
  // Non-finite → false (honest, never a truthy accident).
  assert.equal(meetsPersistence({ distinct_session_days: NaN as unknown as number }), false);
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

test("promoted candidates drop off the WATCH-eligible rail", async () => {
  const { accessors } = makeFakeAccessors();
  await observeSwingCandidate(accessors, { ticker: "AMD", direction: "SHORT", sessionDay: "2026-07-22", phase: "POST_CLOSE" });
  await observeSwingCandidate(accessors, { ticker: "AMD", direction: "SHORT", sessionDay: "2026-07-23", phase: "POST_CLOSE" });
  assert.equal((await fetchWatchEligible(accessors)).length, 1);

  await promoteSwingCandidate(accessors, "AMD", "SHORT", 42);
  assert.equal((await fetchWatchEligible(accessors)).length, 0, "promoted row no longer counts as a fresh candidate");
});
