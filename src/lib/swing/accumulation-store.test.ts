import { test } from "node:test";
import assert from "node:assert/strict";
import {
  meetsPersistence,
  observeSwingCandidate,
  fetchWatchEligible,
  promoteSwingCandidate,
  fromStoreDir,
  swingThesisKey,
  normalizeSwingAccumArchetype,
  SWING_ACCUM_UNCLASSIFIED,
  MIN_PERSISTENCE_SESSIONS,
  type SwingAccumAccessors,
} from "./accumulation-store.ts";
import type { SwingAccumRow } from "../db.ts";

// In-memory fake of the PR-10 accessors, mirroring the upsert's distinct-day semantics: a +1 distinct day
// ONLY when the session day actually changes (repeats within a day don't count). Keyed by thesis
// (ticker|direction|archetype) so archetype flips do not share persistence history.
function makeFakeAccessors() {
  const rows = new Map<string, SwingAccumRow>();
  const now = () => new Date("2026-07-24T21:00:00Z").toISOString();
  const keyOf = (ticker: string, direction: string, archetype: string) =>
    `${ticker.toUpperCase()}|${direction}|${normalizeSwingAccumArchetype(archetype)}`;
  const accessors: SwingAccumAccessors = {
    async upsertSwingAccum(a) {
      const archetype = normalizeSwingAccumArchetype(a.archetype);
      const key = keyOf(a.ticker, a.direction, archetype);
      const cur = rows.get(key);
      if (!cur) {
        rows.set(key, {
          ticker: a.ticker.toUpperCase(),
          direction: a.direction,
          archetype,
          observation_count: 1,
          distinct_session_days: 1,
          last_session_day: a.session_day,
          phases_seen: [a.phase],
          signal_kinds: [...new Set(a.signal_kinds ?? [])],
          last_session_signal_kinds: [...new Set(a.signal_kinds ?? [])],
          promoted_position_id: null,
          first_seen_at: now(),
          last_seen_at: now(),
        });
      } else {
        cur.observation_count += 1;
        const isNewSession = cur.last_session_day !== a.session_day;
        if (isNewSession) cur.distinct_session_days += 1;
        if (isNewSession) {
          cur.last_session_signal_kinds = [...new Set(a.signal_kinds ?? [])];
        } else {
          for (const k of a.signal_kinds ?? []) {
            if (!(cur.last_session_signal_kinds ?? []).includes(k)) {
              cur.last_session_signal_kinds = [...(cur.last_session_signal_kinds ?? []), k];
            }
          }
        }
        cur.last_session_day = a.session_day;
        if (!(cur.phases_seen ?? []).includes(a.phase)) cur.phases_seen = [...(cur.phases_seen ?? []), a.phase];
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
    async markAccumPromoted(ticker, direction, positionId, archetype = SWING_ACCUM_UNCLASSIFIED) {
      const cur = rows.get(keyOf(ticker, direction, archetype ?? SWING_ACCUM_UNCLASSIFIED));
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
  for (const a of ["BREAKOUT", "PULLBACK_CONTINUATION", "MEAN_REVERSION", "SECTOR_ROTATION"] as const) {
    assert.equal(meetsPersistence({ distinct_session_days: 1, signal_kinds: ["FLOW", "STRUCTURE"] }, a), false, `${a} needs 2 sessions`);
    assert.equal(meetsPersistence({ distinct_session_days: 2, signal_kinds: ["FLOW"] }, a), true, `${a} clears at 2 sessions`);
  }
});

test("meetsPersistence: event archetypes clear on 1 session + corroboration, NOT on a lone print (anti-lone-print)", () => {
  for (const a of ["EVENT_DRIVEN", "POST_EARNINGS_DRIFT"] as const) {
    assert.equal(
      meetsPersistence({ distinct_session_days: 1, observation_count: 2, last_session_signal_kinds: ["FLOW", "CATALYST"] }, a),
      true,
      `${a}: 1 session + 2 distinct signal kinds promotes`,
    );
    assert.equal(
      meetsPersistence({ distinct_session_days: 1, observation_count: 1, last_session_signal_kinds: ["FLOW"] }, a),
      false,
      `${a}: a lone print never promotes (anti-lone-print invariant holds)`,
    );
    assert.equal(
      meetsPersistence({ distinct_session_days: 2, observation_count: 2, last_session_signal_kinds: ["FLOW"] }, a),
      true,
      `${a}: a 2nd session corroborates on its own`,
    );
    assert.equal(
      meetsPersistence({ distinct_session_days: 1, observation_count: 5, last_session_signal_kinds: ["FLOW"] }, a),
      false,
      `${a}: repeated same-kind prints are not corroboration`,
    );
    // Lifetime kinds from prior sessions must NOT corroborate today's lone print.
    assert.equal(
      meetsPersistence({
        distinct_session_days: 1,
        observation_count: 2,
        signal_kinds: ["FLOW", "STRUCTURE"],
        last_session_signal_kinds: ["FLOW"],
      }, a),
      false,
      `${a}: lifetime signal_kinds do not substitute for session-scoped corroboration`,
    );
  }
  assert.equal(
    meetsPersistence({ distinct_session_days: 1, observation_count: 1, last_session_signal_kinds: ["STRUCTURE"] }, "FAILED_BREAKDOWN"),
    true,
    "FAILED_BREAKDOWN: 1 session STRUCTURE reclaim promotes",
  );
});

test("meetsPersistence: corroboration counts distinct signal KINDS on the latest session, not cadence PHASES", () => {
  for (const a of ["EVENT_DRIVEN", "POST_EARNINGS_DRIFT"] as const) {
    assert.equal(
      meetsPersistence({ distinct_session_days: 1, observation_count: 2, last_session_signal_kinds: ["FLOW"] }, a),
      false,
      `${a}: one kind re-seen across cadence windows is NOT corroboration`,
    );
    assert.equal(
      meetsPersistence({ distinct_session_days: 1, observation_count: 2, last_session_signal_kinds: ["FLOW", "CATALYST"] }, a),
      true,
      `${a}: a second independent signal KIND corroborates`,
    );
  }
  assert.equal(
    meetsPersistence({ distinct_session_days: 1, observation_count: 4, last_session_signal_kinds: [] }, "EVENT_DRIVEN"),
    false,
    "empty last_session_signal_kinds is never self-corroborating",
  );
});

test("fromStoreDir converts lowercase table direction back to PlayDirection", () => {
  assert.equal(fromStoreDir("long"), "LONG");
  assert.equal(fromStoreDir("short"), "SHORT");
});

test("swingThesisKey partitions by archetype; null → UNCLASSIFIED", () => {
  assert.equal(swingThesisKey("nvda", "LONG", "BREAKOUT"), "NVDA|LONG|BREAKOUT");
  assert.equal(swingThesisKey("NVDA", "long", null), `NVDA|LONG|${SWING_ACCUM_UNCLASSIFIED}`);
  assert.equal(normalizeSwingAccumArchetype("mean_reversion"), "MEAN_REVERSION");
  assert.equal(normalizeSwingAccumArchetype("NOPE"), SWING_ACCUM_UNCLASSIFIED);
});

test("a 1-session candidate stays below persistence; a 2-distinct-session candidate clears it", async () => {
  const { accessors } = makeFakeAccessors();

  await observeSwingCandidate(accessors, {
    ticker: "NVDA",
    direction: "LONG",
    archetype: "FLOW_ACCUMULATION",
    sessionDay: "2026-07-23",
    phase: "POST_CLOSE",
  });
  await observeSwingCandidate(accessors, {
    ticker: "NVDA",
    direction: "LONG",
    archetype: "FLOW_ACCUMULATION",
    sessionDay: "2026-07-23",
    phase: "MIDDAY",
  });

  let eligible = await fetchWatchEligible(accessors);
  assert.equal(eligible.length, 0, "one distinct session day is below the WATCH bar");

  await observeSwingCandidate(accessors, {
    ticker: "NVDA",
    direction: "LONG",
    archetype: "FLOW_ACCUMULATION",
    sessionDay: "2026-07-24",
    phase: "POST_CLOSE",
  });

  eligible = await fetchWatchEligible(accessors);
  assert.equal(eligible.length, 1, "two distinct session days clears the WATCH bar");
  assert.equal(eligible[0].ticker, "NVDA");
  assert.equal(eligible[0].direction, "LONG");
  assert.equal(eligible[0].archetype, "FLOW_ACCUMULATION");
  assert.equal(eligible[0].distinctSessionDays, 2);
  assert.equal(eligible[0].observationCount, 3);
  assert.deepEqual([...eligible[0].phasesSeen].sort(), ["MIDDAY", "POST_CLOSE"]);
});

test("THESIS KEY: archetype flip does NOT inherit prior thesis session count (release-blocking)", async () => {
  const { accessors, rows } = makeFakeAccessors();

  // Day 1+2: FLOW_ACCUMULATION builds to WATCH-eligible.
  await observeSwingCandidate(accessors, {
    ticker: "NVDA", direction: "LONG", archetype: "FLOW_ACCUMULATION",
    sessionDay: "2026-07-22", phase: "POST_CLOSE", signalKinds: ["FLOW"],
  });
  await observeSwingCandidate(accessors, {
    ticker: "NVDA", direction: "LONG", archetype: "FLOW_ACCUMULATION",
    sessionDay: "2026-07-23", phase: "POST_CLOSE", signalKinds: ["FLOW"],
  });
  assert.equal((await fetchWatchEligible(accessors)).length, 1);

  // Day 3: same name+side, NEW archetype (MEAN_REVERSION) — must start at 1 session, NOT inherit 2.
  await observeSwingCandidate(accessors, {
    ticker: "NVDA", direction: "LONG", archetype: "MEAN_REVERSION",
    sessionDay: "2026-07-24", phase: "POST_CLOSE", signalKinds: ["STRUCTURE"],
  });
  const eligible = await fetchWatchEligible(accessors);
  const mean = eligible.find((c) => c.archetype === "MEAN_REVERSION");
  assert.equal(mean, undefined, "MEAN_REVERSION must NOT clear on a first sighting by inheriting FLOW history");
  const flow = eligible.find((c) => c.archetype === "FLOW_ACCUMULATION");
  assert.ok(flow, "prior FLOW_ACCUMULATION thesis still exists as its own row");
  assert.equal(rows.size, 2, "two distinct thesis rows for the same ticker|direction");
  assert.equal(
    rows.get("NVDA|long|MEAN_REVERSION")?.distinct_session_days,
    1,
    "new archetype starts at 1 distinct session",
  );
});

test("live UNCLASSIFIED observations never merge into a classified thesis", async () => {
  const { accessors, rows } = makeFakeAccessors();
  await observeSwingCandidate(accessors, {
    ticker: "NVDA", direction: "LONG", archetype: null,
    sessionDay: "2026-07-23", phase: "LIVE_FLOW", signalKinds: ["FLOW"],
  });
  await observeSwingCandidate(accessors, {
    ticker: "NVDA", direction: "LONG", archetype: "BREAKOUT",
    sessionDay: "2026-07-23", phase: "POST_CLOSE", signalKinds: ["STRUCTURE"],
  });
  assert.equal(rows.size, 2);
  assert.equal(rows.get(`NVDA|long|${SWING_ACCUM_UNCLASSIFIED}`)?.distinct_session_days, 1);
  assert.equal(rows.get("NVDA|long|BREAKOUT")?.distinct_session_days, 1);
});

test("fetchWatchEligible: a corroborated 1-session EVENT_DRIVEN row surfaces from its stored archetype", async () => {
  const { accessors } = makeFakeAccessors();

  await observeSwingCandidate(accessors, {
    ticker: "MRNA", direction: "LONG", archetype: "EVENT_DRIVEN",
    sessionDay: "2026-07-24", phase: "POST_CLOSE", signalKinds: ["FLOW"],
  });
  await observeSwingCandidate(accessors, {
    ticker: "MRNA", direction: "LONG", archetype: "EVENT_DRIVEN",
    sessionDay: "2026-07-24", phase: "POST_CLOSE", signalKinds: ["CATALYST"],
  });
  await observeSwingCandidate(accessors, {
    ticker: "PLTR", direction: "LONG", archetype: "EVENT_DRIVEN",
    sessionDay: "2026-07-24", phase: "POST_CLOSE", signalKinds: ["FLOW"],
  });

  const eligible = await fetchWatchEligible(accessors);
  assert.deepEqual(eligible.map((c) => c.ticker).sort(), ["MRNA"]);
  assert.equal(eligible[0].archetype, "EVENT_DRIVEN");
  assert.deepEqual([...eligible[0].signalKinds].sort(), ["CATALYST", "FLOW"]);
});

test("promoted candidates drop off the WATCH-eligible rail (thesis-scoped)", async () => {
  const { accessors } = makeFakeAccessors();
  await observeSwingCandidate(accessors, {
    ticker: "AMD", direction: "SHORT", archetype: "BREAKOUT",
    sessionDay: "2026-07-22", phase: "POST_CLOSE",
  });
  await observeSwingCandidate(accessors, {
    ticker: "AMD", direction: "SHORT", archetype: "BREAKOUT",
    sessionDay: "2026-07-23", phase: "POST_CLOSE",
  });
  // Sibling thesis on same name+side must survive promotion of BREAKOUT.
  await observeSwingCandidate(accessors, {
    ticker: "AMD", direction: "SHORT", archetype: "MEAN_REVERSION",
    sessionDay: "2026-07-22", phase: "POST_CLOSE",
  });
  await observeSwingCandidate(accessors, {
    ticker: "AMD", direction: "SHORT", archetype: "MEAN_REVERSION",
    sessionDay: "2026-07-23", phase: "POST_CLOSE",
  });
  assert.equal((await fetchWatchEligible(accessors)).length, 2);

  await promoteSwingCandidate(accessors, "AMD", "SHORT", 42, "BREAKOUT");
  const left = await fetchWatchEligible(accessors);
  assert.equal(left.length, 1, "only the promoted thesis is retired");
  assert.equal(left[0].archetype, "MEAN_REVERSION");
});
