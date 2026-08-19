import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseOpsCollectPayload,
  gridOpsItems,
  spxOpsItems,
  shouldRetryWatchdogFetch,
  watchdogHttpPriority,
  shouldPageNighthawkZeroPlays,
} from "./ops-collect-scope.mjs";

describe("watchdogHttpPriority", () => {
  it("downgrades auth gaps and transient origin errors to P2", () => {
    assert.equal(watchdogHttpPriority(401), "P2");
    assert.equal(watchdogHttpPriority(403), "P2");
    assert.equal(watchdogHttpPriority(502), "P2");
    assert.equal(watchdogHttpPriority(503), "P2");
    assert.equal(watchdogHttpPriority(504), "P2");
    assert.equal(watchdogHttpPriority(524), "P2");
  });

  it("keeps real app failures at P0", () => {
    assert.equal(watchdogHttpPriority(500), "P0");
  });
});

describe("shouldRetryWatchdogFetch", () => {
  it("retries transient and network failures", () => {
    assert.equal(shouldRetryWatchdogFetch(0), true);
    assert.equal(shouldRetryWatchdogFetch(502), true);
    assert.equal(shouldRetryWatchdogFetch(503), true);
    assert.equal(shouldRetryWatchdogFetch(504), true);
    assert.equal(shouldRetryWatchdogFetch(524), true);
    assert.equal(shouldRetryWatchdogFetch(401), false);
    assert.equal(shouldRetryWatchdogFetch(500), false);
  });
});

describe("parseOpsCollectPayload", () => {
  it("parses JSON line from stdout with stderr postgres skip", () => {
    const payload = parseOpsCollectPayload(
      '{"count":0,"items":[]}\n',
      "[ops-collect] Postgres audit skipped (private VPC URL)\n"
    );
    assert.equal(payload?.count, 0);
  });
});

describe("spxOpsItems", () => {
  const items = [
    { id: "correctness:flags", priority: "P0", title: "SPX gex mismatch", detail: "desk layer" },
    { id: "watchdog:problem:flow-ingest", priority: "P1", title: "Cron health", detail: "stale" },
    { id: "correctness:flags", priority: "P0", title: "SPY net_premium", detail: "grid layer" },
  ];

  it("keeps SPX-layer correctness flags", () => {
    const scoped = spxOpsItems(items);
    assert.equal(scoped.length, 1);
    assert.match(scoped[0].title, /SPX gex/);
  });
});

describe("gridOpsItems", () => {
  const items = [
    { id: "correctness:flags", priority: "P0", title: "zerodte board", detail: "grid layer" },
    { id: "watchdog:problem:spx-evaluate", priority: "P1", title: "SPX cron", detail: "stale" },
  ];

  it("keeps grid/zerodte items only", () => {
    const scoped = gridOpsItems(items);
    assert.equal(scoped.length, 1);
    assert.match(scoped[0].title, /zerodte/);
  });
});

describe("shouldPageNighthawkZeroPlays", () => {
  const base = {
    inWindow: true,
    jobStatus: "published",
    editionPresent: true,
    playCount: 0,
    recapOnly: false,
  };

  it("pages on a real zero-play publish without recap_only", () => {
    assert.equal(shouldPageNighthawkZeroPlays(base), true);
  });

  it("does not page outside the edition catchup window", () => {
    assert.equal(shouldPageNighthawkZeroPlays({ ...base, inWindow: false }), false);
  });

  it("does not page when the job is not published yet", () => {
    assert.equal(shouldPageNighthawkZeroPlays({ ...base, jobStatus: "running" }), false);
  });

  it("does not page when no edition row exists yet (pre-publish shell)", () => {
    assert.equal(shouldPageNighthawkZeroPlays({ ...base, editionPresent: false }), false);
  });

  it("does not page when plays exist", () => {
    assert.equal(shouldPageNighthawkZeroPlays({ ...base, playCount: 2 }), false);
  });

  it("does not page on honest recap-only editions", () => {
    assert.equal(shouldPageNighthawkZeroPlays({ ...base, recapOnly: true }), false);
  });
});
