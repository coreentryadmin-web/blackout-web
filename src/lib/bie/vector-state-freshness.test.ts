import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  describeVectorFreshness,
  VECTOR_FRESHNESS_LIVE_SEC,
  VECTOR_FRESHNESS_RECENT_SEC,
} from "./vector-state-freshness";
import { freshnessFromAgeMs } from "./answer-envelope";
import {
  buildPulseSnapshot,
  detectPulseSignals,
  type PulseSnapshot,
} from "@/features/vector/lib/vector-pulse";

/**
 * VECTOR STATE FRESHNESS + the differential-read honesty boundary.
 *
 * TWO DEFECTS, ONE ROOT. `fetchVectorFullState` is cache-first with a 15-minute TTL and the
 * snapshot carries the `asOf` of when it was COMPUTED.
 *
 *  (1) The tools shipped that bare ISO string and nothing else — no age, no "now" to subtract.
 *      `get_vector_pulse` served `as_of: state.asOf`, while EVERY other Largo tool stamps `as_of`
 *      with `new Date()`. A reader that learned `as_of` means "when this was read" from the rest
 *      of the surface is wrong by up to 15 minutes on this one.
 *
 *  (2) Because `asOf` is frozen for the life of the cache entry, two `get_vector_pulse` calls in
 *      that window diff a snapshot against an IDENTICAL one and report `has_baseline: true` with
 *      zero signals — which the tool description tells the model to read as "structure is stable".
 *      The measured before-state:
 *
 *        CALL 1  has_baseline: false  signal_count: 0   as_of: …T14:00:00.000Z
 *        CALL 2  has_baseline: true   signal_count: 0   as_of: …T14:00:00.000Z
 *        prev.at === current.at ? true     snapshots structurally identical ? true
 *
 *      i.e. exactly the "reporting silence as a finding" failure `has_baseline` exists to prevent,
 *      one layer below where the description draws the line.
 */

const T0 = Date.parse("2026-08-21T14:00:00.000Z");

test("freshness reports the age against the READ clock, not the snapshot clock", () => {
  const f = describeVectorFreshness(new Date(T0).toISOString(), T0 + 7 * 60_000);
  assert.equal(f.age_seconds, 420);
  // observed_at stays an ISO INSTANT: the tool description identifies a re-served snapshot by exact
  // string equality with baseline_observed_at, and a minute-resolution ET stamp would collide two
  // distinct observations taken inside the same minute.
  assert.equal(f.observed_at, "2026-08-21T14:00:00.000Z");
  // The regression that hid this: deriving "now" from asOf makes every read look instantaneous.
  assert.notEqual(f.as_of, f.observed_at);
});

test("as_of is an ET stamp with an ET session_date, not a UTC instant", () => {
  // 2026-08-20 20:30 ET is 2026-08-21T00:30Z. A UTC stamp puts the read on the NEXT session — the
  // exact inversion that had a live SPX figure dated forward and a close fabricated for "today".
  const evening = Date.parse("2026-08-21T00:30:00.000Z");
  const f = describeVectorFreshness(new Date(evening - 60_000).toISOString(), evening);
  assert.equal(f.as_of, "2026-08-20 20:30 ET");
  assert.equal(f.session_date, "2026-08-20");
  assert.doesNotMatch(String(f.as_of), /Z$/, "as_of must not be a UTC instant");
});

test("observed_at carries the MEASUREMENT's session, which can differ from the read's", () => {
  // The case that makes this a defect rather than a nicety. A snapshot measured 20:05 ET on the
  // 20th is `2026-08-21T00:05Z`; read four minutes later — still 20:09 ET on the 20th — the block
  // would otherwise ship a UTC instant dated the 21st beside `session_date: "2026-08-20"`, and a
  // model has no way to tell which of the two labels the numbers belong to.
  const measured = Date.parse("2026-08-21T00:05:00.000Z");
  const read = Date.parse("2026-08-21T00:09:00.000Z");
  const f = describeVectorFreshness(new Date(measured).toISOString(), read);

  assert.equal(f.observed_at, "2026-08-21T00:05:00.000Z", "the instant itself is unchanged");
  assert.equal(f.observed_session_date, "2026-08-20", "…but its ET session is the 20th, not the 21st");
  // Both stamps agree here BECAUSE both fall in the same ET session — the point is that the
  // payload now says so rather than leaving the reader to reconcile a Z-suffixed date with it.
  assert.equal(f.session_date, "2026-08-20");
  assert.equal(f.age_seconds, 240);
});

test("observed_session_date tracks the measurement, so it can trail the read by a session", () => {
  // A snapshot measured Thursday 16:00 ET, still cached and read Friday pre-open. The two session
  // dates SHOULD differ, and that difference is the answer to "is this today's tape?".
  const measured = Date.parse("2026-08-20T20:00:00.000Z"); // Thu 16:00 ET
  const read = Date.parse("2026-08-21T12:00:00.000Z"); // Fri 08:00 ET
  const f = describeVectorFreshness(new Date(measured).toISOString(), read);
  assert.equal(f.observed_session_date, "2026-08-20");
  assert.equal(f.session_date, "2026-08-21");
  assert.notEqual(f.observed_session_date, f.session_date);
  assert.equal(f.freshness, "stale", "a session-old snapshot must never read as current");
});

test("an unreadable measurement time yields a NULL session, never the read's session", () => {
  // Relabelling an unknown measurement with today's session is the inversion this whole module
  // exists to prevent — it converts "we cannot tell" into a confident, wrong claim.
  const f = describeVectorFreshness("not-a-timestamp", T0);
  assert.equal(f.observed_session_date, null);
  assert.equal(f.freshness, "unknown");
  assert.notEqual(f.observed_session_date, f.session_date);
});

test("the full-state snapshot PERSISTS its ET anchor — contract C1, and it is not read-derived", () => {
  // Contract C1 (session-anchor.test.ts) enforces that this module CALLS the helpers; this asserts
  // the two properties that test cannot see:
  //   - the anchor is stamped from the SAME `asOfMs` as `asOf`, so a slow fan-out can never
  //     produce a state whose instant and session date straddle a boundary;
  //   - `new Date().toISOString()` — an independent second clock read — is gone from the file.
  const src = readFileSync("src/lib/bie/vector-full-state.ts", "utf8");
  assert.match(src, /asOf:\s*new Date\(asOfMs\)\.toISOString\(\)/);
  assert.match(src, /asOfEt:\s*etStamp\(asOfMs\)/);
  assert.match(src, /sessionDate:\s*etSessionDate\(asOfMs\)/);
  assert.doesNotMatch(
    src,
    /new Date\(\)\.toISOString\(\)/,
    "a second bare clock read would let asOf and its session anchor disagree"
  );
  // The anchor is PERSISTED — stamped inside `computeVectorFullState`, which is the object that
  // gets written to the cache — not attached by the read-time wrapper. "Which session was this
  // measured in" is frozen at measurement; "how old is it" is not, and they must not share a home.
  // Sliced at the function boundary rather than regexed over the whole file, so this cannot pass
  // merely because the wrapper happens to be defined last.
  const boundary = src.indexOf("export async function fetchVectorFullState");
  assert.ok(boundary > 0, "expected the cache-first entry point to exist");
  const computeBody = src.slice(src.indexOf("export async function computeVectorFullState"), boundary);
  assert.match(computeBody, /sessionDate:\s*etSessionDate\(asOfMs\)/, "the anchor belongs to the measurement");
  assert.doesNotMatch(
    src.slice(boundary),
    /sessionDate:\s*etSessionDate/,
    "the read path must not re-stamp the measurement's session"
  );
});

test("the tiers ARE freshnessFromAgeMs's — one classifier for the product, not a second", () => {
  const at = (sec: number) => describeVectorFreshness(new Date(T0).toISOString(), T0 + sec * 1000);
  assert.equal(at(0).freshness, "live");
  assert.equal(at(VECTOR_FRESHNESS_LIVE_SEC - 1).freshness, "live");
  assert.equal(at(VECTOR_FRESHNESS_LIVE_SEC).freshness, "recent");
  assert.equal(at(VECTOR_FRESHNESS_RECENT_SEC - 1).freshness, "recent");
  assert.equal(at(VECTOR_FRESHNESS_RECENT_SEC).freshness, "stale");
  // The full TTL is reachable in practice and must read as stale, loudly.
  assert.equal(at(15 * 60).freshness, "stale");
  assert.match(at(15 * 60).note!, /15m ago/);

  // The point of reusing it: a Vector state can never be `recent` to one part of the product and
  // `stale` to another. This block and answer-envelope/scenario-read must agree at EVERY age.
  for (const sec of [0, 30, 59, 60, 300, 599, 600, 601, 900, 3600]) {
    assert.equal(
      at(sec).freshness,
      freshnessFromAgeMs(sec * 1000),
      `disagreement at ${sec}s — the two classifiers have forked again`
    );
  }
});

test("only a non-live read carries a disclosure note", () => {
  assert.equal(describeVectorFreshness(new Date(T0).toISOString(), T0).note, null);
  assert.ok(describeVectorFreshness(new Date(T0).toISOString(), T0 + 10 * 60_000).note);
});

test("an unreadable timestamp is 'unknown', never 'live'", () => {
  for (const bad of [null, undefined, "", "not-a-date"]) {
    const f = describeVectorFreshness(bad, T0);
    assert.equal(f.freshness, "unknown", `${String(bad)} must not read as fresh`);
    assert.equal(f.age_seconds, null);
    assert.match(f.note!, /age is unknown/);
  }
});

test("clock skew cannot produce a negative age", () => {
  // A snapshot stamped in the future would otherwise report "fresher than live".
  const f = describeVectorFreshness(new Date(T0 + 30_000).toISOString(), T0);
  assert.equal(f.age_seconds, 0);
  assert.equal(f.freshness, "live");
});

// ---------------------------------------------------------------------------
// The differential-read boundary
// ---------------------------------------------------------------------------

const SNAP = (at: number): PulseSnapshot =>
  buildPulseSnapshot({
    at,
    regime: { posture: "long", headline: "LONG GAMMA", read: "dealers dampen moves" } as never,
    proximity: { strike: 7600, side: "call", distancePct: 0.53, nearness: "testing", callout: "x" },
    magnet: { strike: 7555.5, distancePct: -0.06, pull: "at", posture: "long", callout: "x" },
    wallIntegrity: { call: null, put: null },
    wallEventCount: 3,
  });

test("a snapshot diffed against ITSELF yields no signals — the false-quiet case", () => {
  const a = SNAP(T0);
  const b = SNAP(T0); // same cached state re-read inside the 15-min TTL
  assert.deepEqual(detectPulseSignals(a, b), [], "identical observations cannot produce signals");
  // And the two ends of the diff are the SAME observation, which is what must be surfaced.
  assert.equal(a.at, b.at);
});

test("is_new_observation is derived from snapshot.at, and separates the two empty states", () => {
  const current = SNAP(T0);
  // Re-read of the same cached snapshot -> NOT a new observation.
  assert.equal(SNAP(T0).at === current.at, true);
  // A genuinely refreshed snapshot -> a new observation, even with identical structure.
  assert.equal(SNAP(T0 + 5 * 60_000).at === current.at, false);
});

test("the pulse tool ships is_new_observation and the freshness block", () => {
  // Source-read: product-reads.ts pulls Redis and the provider graph, so the assertion is that the
  // tool's payload declares these fields at all — their absence IS the defect.
  const src = readFileSync("src/lib/largo/product-reads.ts", "utf8");
  assert.match(src, /is_new_observation/, "get_vector_pulse must declare is_new_observation");
  assert.match(src, /baseline_observed_at/, "get_vector_pulse must expose the baseline's own instant");
  assert.match(src, /describeVectorFreshness\(state\.asOf, readMs\)/, "freshness must use the READ clock");
  // The overclaim fix: the flag is about the VECTOR STATE, and is suppressed when age is unknown.
  assert.match(src, /freshnessBlock\.freshness === "unknown" \? null : isNewObservation/);
  // The read clock must be the real wall clock, not re-derived from the cached snapshot.
  assert.match(src, /const readMs = Date\.now\(\);/);
});

test("freshness is attached at the SHARED entry point, so every consumer gets it", () => {
  // The blast radius fix. A dozen surfaces read this state — get_ecosystem_context, the
  // wall-dynamics reader, desk-scope-prefetch, mini-panel, full-platform-snapshot, scenario-read,
  // play-suggest-read, slash-prompts, the largo status/context routes, Cortex. Attaching in a
  // caller-side wrapper would have left all of them serving a 15-minute-old snapshot as current.
  const src = readFileSync("src/lib/bie/vector-full-state.ts", "utf8");
  // Matches the composed name too: the absence-report PR wraps the SAME function, and when both
  // land the two helpers compose into `withReadContext`. Asserting the exact helper NAME would
  // fail on the merge while the behaviour it checks is intact — pin the seam, not the spelling.
  assert.match(src, /if \(cached\) return with(?:Freshness|ReadContext)\(cached\);/);
  assert.match(src, /return live \? with(?:Freshness|ReadContext)\(live\) : null;/);
  // And nothing time-dependent may be persisted: the cache is written the RAW state.
  assert.match(src, /void writeVectorFullStateCache\(ticker, horizon, live\)/);
});

test("scenario-read MEASURES provenance freshness instead of asserting it", () => {
  const src = readFileSync("src/lib/bie/scenario-read.ts", "utf8");
  assert.doesNotMatch(src, /freshness: "recent"/, "a hardcoded freshness is a claim nothing checked");
  assert.match(src, /freshness: freshnessFromAgeMs\(/);
});

test("the capability registry no longer calls this surface realtime", () => {
  const src = readFileSync("src/lib/largo/registry/capability-registry.ts", "utf8");
  const block = src.slice(src.indexOf('id: "vector.full_state"'), src.indexOf('id: "vector.chart_analytics"'));
  assert.doesNotMatch(block, /freshness: "realtime"/, "a 15-min cache is not sub-minute");
  assert.match(block, /freshness: "periodic"/);
});

test("both tool descriptions teach the distinctions they now ship", () => {
  const src = readFileSync("src/lib/largo/tool-defs.ts", "utf8");
  // A field the model is never told about is a field the model will not use.
  assert.match(src, /`is_new_observation` is the SECOND way an empty list can be uninformative/);
  assert.match(src, /Only report a quiet tape when `has_baseline` is true AND `is_new_observation` is true/);
  assert.match(src, /`observed_at` is when the Vector state was MEASURED/);
  assert.match(src, /`is_new_observation` is NULL when `freshness` is 'unknown'/);
  assert.match(src, /FRESHNESS: this state is served from a cache that can be up to 15 minutes old/);
});
