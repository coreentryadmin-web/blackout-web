import { test } from "node:test";
import assert from "node:assert/strict";
import { withSim } from "./api";

// Regression guard for the sim URL footgun (SPX desk-path sim). The SPX fetchers are
// `(sim?: boolean) => marketFetch(withSim(path, sim))`. SWR invokes a fetcher with the KEY
// as its first argument, so a fetcher passed BARE to useSWR would receive the truthy key
// string as `sim` → `?sim=1` for every member. These tests lock the ONLY correct behavior:
// a member (no sim / sim=false) gets the untouched path; the truthy-string case (the bug)
// would have appended sim — proving why every call site must arrow-wrap `() => fetchSpx*()`.

test("member path is byte-identical: no arg → no sim param", () => {
  assert.equal(withSim("/spx/play"), "/spx/play");
  assert.equal(withSim("/spx/desk"), "/spx/desk");
});

test("explicit sim=false → no sim param", () => {
  assert.equal(withSim("/spx/play", false), "/spx/play");
});

test("sim=true appends sim=1 (correct separator)", () => {
  assert.equal(withSim("/spx/play", true), "/spx/play?sim=1");
  assert.equal(withSim("/gex-heatmap?ticker=SPX", true), "/gex-heatmap?ticker=SPX&sim=1");
});

test("the footgun: a truthy SWR-key string would wrongly enable sim (why bare fetchers are banned)", () => {
  // If `fetchSpxPlay` were passed bare, SWR would call it as fetchSpxPlay("vector-spx-playbook"),
  // and that truthy string reaches withSim as `sim` → sim=1. Arrow-wrapping prevents this.
  assert.equal(withSim("/spx/play", "vector-spx-playbook" as unknown as boolean), "/spx/play?sim=1");
});
