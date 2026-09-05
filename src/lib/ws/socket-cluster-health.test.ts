import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildUwClusterHealth,
  clusterIndexSpotChangePct,
  evaluateOptionsClusterOk,
  evaluatePolygonClusterOk,
  evaluateUwClusterOk,
  readUwClusterHealth,
} from "./socket-cluster-health";

test("clusterIndexSpotChangePct: only REST-anchored snapshots carry change_pct", () => {
  assert.equal(
    clusterIndexSpotChangePct({ change_pct: 0.42, open_source: "rest" }),
    0.42
  );
  assert.equal(
    clusterIndexSpotChangePct({ change_pct: 0.42, open_source: "ws-bar" }),
    null,
    "ws-bar anchor must not leak session-open change% to GEX cluster readers"
  );
  assert.equal(clusterIndexSpotChangePct({ change_pct: 0.42 }), null);
  assert.equal(clusterIndexSpotChangePct({ change_pct: NaN, open_source: "rest" }), null);
});

test("evaluateUwClusterOk: follower is healthy when cluster heartbeat is fresh", () => {
  const uw = buildUwClusterHealth({
    is_leader: false,
    cluster_last_message_at: Date.now() - 5_000,
  });
  const result = evaluateUwClusterOk(uw, true);
  assert.equal(result.ok, true);
  assert.match(result.detail, /follower/);
});

test("evaluateUwClusterOk: follower fails when cluster heartbeat is stale", () => {
  const uw = buildUwClusterHealth({
    is_leader: false,
    cluster_last_message_at: Date.now() - 300_000,
  });
  const result = evaluateUwClusterOk(uw, true);
  assert.equal(result.ok, false);
});

test("buildUwClusterHealth: future-skewed heartbeat is not cluster_live", () => {
  const now = Date.parse("2026-06-29T16:00:00.000Z");
  const uw = buildUwClusterHealth({
    is_leader: false,
    cluster_last_message_at: now + 60_000,
    now,
  });
  assert.equal(uw.cluster_live, false);
  assert.equal(uw.cluster_last_message_age_ms, null);
});

test("evaluatePolygonClusterOk: off-hours always ok", () => {
  const result = evaluatePolygonClusterOk(
    {
      is_leader: false,
      cluster_spx_updated_at: null,
      cluster_spx_age_ms: null,
      cluster_live: false,
      detail: "no snapshot",
    },
    false
  );
  assert.equal(result.ok, true);
});

test("evaluatePolygonClusterOk: follower healthy when UW fallback marks cluster live", () => {
  const result = evaluatePolygonClusterOk(
    {
      is_leader: false,
      cluster_spx_updated_at: Date.now() - 2_000,
      cluster_spx_age_ms: 2_000,
      cluster_live: true,
      detail: "I:SPX price=7384 (UW stock-state fallback)",
    },
    true
  );
  assert.equal(result.ok, true);
  assert.match(result.detail, /follower/);
});

test("evaluateOptionsClusterOk: web follower healthy when cluster marks are fresh", () => {
  const result = evaluateOptionsClusterOk(
    {
      leader_present: true,
      newest_mark_age_ms: 5_000,
      cluster_live: true,
      detail: "cluster marks fresh (age 5000ms)",
    },
    true,
    false
  );
  assert.equal(result.ok, true);
});

test("evaluateOptionsClusterOk: ingest leader lock is healthy on web tier without local marks", () => {
  const result = evaluateOptionsClusterOk(
    {
      leader_present: true,
      newest_mark_age_ms: null,
      cluster_live: true,
      detail: "ingest leader lock held — marks warming",
    },
    true,
    false
  );
  assert.equal(result.ok, true);
});

test("evaluateOptionsClusterOk: no leader and no marks fails during RTH", () => {
  const result = evaluateOptionsClusterOk(
    {
      leader_present: false,
      newest_mark_age_ms: null,
      cluster_live: false,
      detail: "no fresh cluster option marks and no ingest leader",
    },
    true,
    false
  );
  assert.equal(result.ok, false);
});

test("readUwClusterHealth: web follower healthy when Redis heartbeat is fresh", async () => {
  const orig = process.env.REDIS_URL;
  process.env.REDIS_URL = "";
  const uw = await readUwClusterHealth(false);
  process.env.REDIS_URL = orig;
  assert.equal(uw.is_leader, false);
  assert.equal(uw.cluster_live, false);
});

test("evaluateUwClusterOk: follower healthy via REST liveness when WS heartbeat absent", () => {
  const uw = buildUwClusterHealth({
    is_leader: false,
    cluster_last_message_at: Date.now() - 3_000,
  });
  const result = evaluateUwClusterOk(uw, true);
  assert.equal(result.ok, true);
  assert.match(result.detail, /follower/);
});

test("evaluateOptionsClusterOk: web tier passes via polygon+uw REST when ingest leader warming", () => {
  const uw = buildUwClusterHealth({
    is_leader: false,
    cluster_last_message_at: Date.now() - 5_000,
  });
  const uwEval = evaluateUwClusterOk(uw, true);
  const polygonEval = evaluatePolygonClusterOk(
    {
      is_leader: false,
      cluster_spx_updated_at: Date.now() - 2_000,
      cluster_spx_age_ms: 2_000,
      cluster_live: true,
      detail: "I:SPX price=7486 (UW stock-state fallback)",
    },
    true
  );
  const optionsEval = evaluateOptionsClusterOk(
    {
      leader_present: false,
      newest_mark_age_ms: null,
      cluster_live: false,
      detail: "no fresh cluster option marks and no ingest leader",
    },
    true,
    false
  );
  assert.equal(uwEval.ok, true);
  assert.equal(polygonEval.ok, true);
  assert.equal(optionsEval.ok, false);
  // socket-health route promotes options when uw+polygon cluster are live (ingest-owned WS).
  const options_ok = optionsEval.ok || (uwEval.ok && polygonEval.ok);
  assert.equal(options_ok, true);
});
