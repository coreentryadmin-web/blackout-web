import { test } from "node:test";
import assert from "node:assert/strict";

import { pickNarrowedWallSample, RECORDED_WALL_HORIZONS } from "./vector-narrowed-wall-core";
import type { GexWalls } from "@/lib/providers/gex-wall-levels";
import { readFileSync } from "node:fs";

// The narrowed-horizon wall recorder's pure decision core — the fix for the "frozen 0DTE rail".
// Old behaviour dropped the bucket whenever a horizon's per-expiry reconstruction was empty (silent
// skip), so the SPX 0DTE rail advanced ~1/25min. New behaviour FALLS BACK to the blended near-term
// walls so the rail keeps advancing; only a true all-empty read records an honest gap.

const horizonWalls: GexWalls = { callWalls: [{ strike: 7600, pct: 6 }], putWalls: [{ strike: 7495, pct: 2 }] };
const blendedWalls: GexWalls = { callWalls: [{ strike: 7550, pct: 4 }], putWalls: [{ strike: 7500, pct: 3 }] };
const empty: GexWalls = { callWalls: [], putWalls: [] };

test("RECORDED_WALL_HORIZONS covers exactly the three narrowed horizons", () => {
  assert.deepEqual([...RECORDED_WALL_HORIZONS], ["0dte", "weekly", "monthly"]);
});

test("horizon walls present → records the horizon-scoped walls", () => {
  const { sample, source } = pickNarrowedWallSample({
    time: 1000,
    horizonWalls,
    horizonFlip: 7536,
    blendedWalls,
    blendedFlip: 7540,
  });
  assert.equal(source, "horizon");
  assert.ok(sample);
  assert.equal(sample.walls.callWalls[0].strike, 7600);
  assert.equal(sample.gammaFlip, 7536);
});

test("horizon empty → HONEST GAP even when blended walls exist (fallback removed 2026-07-13)", () => {
  // The old blended-fallback recorded the all-day-stable blended ladder INTO narrowed rails —
  // on non-expiry days (TSLA Monday: no 0DTE chain) the entire "0DTE" rail became mislabeled
  // blended data: full-width static trails, no births/deaths (member-caught live). Wrong-scope
  // data is worse than a gap: a bead on a narrowed lens must BE that horizon's structure.
  const { sample, source } = pickNarrowedWallSample({
    time: 1000,
    horizonWalls: empty,
    horizonFlip: null,
    blendedWalls,
    blendedFlip: 7540,
  });
  assert.equal(source, "empty");
  assert.equal(sample, null);
});

test("both empty → honest gap (no sample)", () => {
  const { sample, source } = pickNarrowedWallSample({
    time: 1000,
    horizonWalls: empty,
    horizonFlip: null,
    blendedWalls: null,
    blendedFlip: null,
  });
  assert.equal(source, "empty");
  assert.equal(sample, null);
});

test("null horizon walls (reconstruction failed) → honest gap, never blended", () => {
  const { sample, source } = pickNarrowedWallSample({
    time: 1000,
    horizonWalls: null,
    horizonFlip: null,
    blendedWalls,
    blendedFlip: 7540,
  });
  assert.equal(source, "empty");
  assert.equal(sample, null);
});

// ── Concurrency of the per-horizon recorder ───────────────────────────────────────────────────

test("SOURCE GUARD: the horizon loop must not go back to awaiting one horizon at a time", () => {
  // `buildNarrowedHorizonWallSamples` lives in vector-snapshot.ts, which pulls the whole server
  // graph (Redis, WS state) and cannot be imported in a unit test. Asserting on its SOURCE is the
  // honest option: it pins the property without pretending to exercise the runtime.
  //
  // Why it is worth pinning at all: the loop used to `await` each horizon in turn, so every ticker
  // paid the SUM of three independent reads and the recorder does that for ~122 tickers a sweep.
  // That serial tail is what kept the sweep over its 5s budget even after sharding — the live
  // alarm reported a 56s sweep for an 83-ticker slice on 2026-08-12. A refactor that reintroduces
  // `for (const horizon ...) await` would silently restore the regression, and the only symptom
  // would be thin beads noticed by a member days later, which is exactly how this bug survived
  // twice already.
  const src = readFileSync(
    new URL("./vector-snapshot.ts", import.meta.url),
    "utf8"
  );
  const fn = src.slice(src.indexOf("export async function buildNarrowedHorizonWallSamples"));
  const body = fn.slice(0, fn.indexOf("\n}\n") + 3);

  assert.match(
    body,
    /RECORDED_WALL_HORIZONS\.map\(/,
    "horizons must be mapped concurrently, not iterated with await"
  );
  assert.doesNotMatch(
    body,
    /for\s*\(\s*const\s+horizon\s+of\s+RECORDED_WALL_HORIZONS/,
    "a sequential for-of over the horizons is the regression this guards"
  );
  // The per-horizon try/catch must survive: wrapping the whole Promise.all instead would let ONE
  // failing horizon blank all three, turning a partial gap into a total one.
  assert.match(body, /catch\s*\(err\)/, "each horizon keeps its own error boundary");
  assert.match(body, /source:\s*"error"/, "a failed horizon still reports itself, per horizon");
});
