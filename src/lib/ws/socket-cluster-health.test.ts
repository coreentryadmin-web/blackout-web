import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildUwClusterHealth,
  evaluateOptionsClusterOk,
  evaluatePolygonClusterOk,
  evaluateUwClusterOk,
} from "./socket-cluster-health";

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

test("evaluateOptionsClusterOk: ingest leader requires local auth when marks missing", () => {
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
