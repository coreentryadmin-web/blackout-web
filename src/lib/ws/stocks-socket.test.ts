import { test } from "node:test";
import assert from "node:assert/strict";
import { isLuldHaltSourceStaleForState } from "./stocks-socket";

// Regression coverage for isLuldHaltSourceStale's decision core (isLuldHaltSourceStaleForState).
//
// Root cause being guarded against: the shipped isLuldHaltSourceStale() used to return `false`
// (fresh) the instant the local stocks socket was `readyState === OPEN && authenticated`, with NO
// reference to whether any message had actually been delivered recently. A half-open TCP socket
// (a real, previously-hardened-against failure mode elsewhere in this file — see
// startStocksWatchdog/STOCKS_STALL_MS above, and polygon-socket.ts's INDICES_STALL_MS) can hold
// readyState OPEN and `stocksAuthenticated=true` indefinitely while silently delivering nothing.
// In that state the OLD code reported "fresh" forever, which meant isTradingHaltChannelStale()
// (uw-socket.ts) could compute `uwStale && luldStale` = `true && false` = `false` even though
// NEITHER halt source was actually live — shouldBlockForTradingHalt() would then let new 0DTE
// entries through against a symbol that could be halted with nobody watching.

test("isLuldHaltSourceStaleForState: half-open connection (OPEN+authed, no recent delivery) is STALE — the core regression", () => {
  const now = 1_000_000;
  const maxAgeMs = 120_000;
  // connectionOpen=true (readyState OPEN && authenticated), but the freshest local delivery
  // (max of lastStocksMessageAt / luldHaltsStore.last_message_at) is well past maxAgeMs, and
  // neither the cluster heartbeat nor the store's own last_message_at is fresh either.
  const localFreshestAt = now - 10 * 60_000; // 10 minutes ago — way past a 2-minute threshold
  const clusterMessageAt = null;
  const ownLastMessageAt = now - 10 * 60_000;
  assert.equal(
    isLuldHaltSourceStaleForState(true, localFreshestAt, clusterMessageAt, ownLastMessageAt, maxAgeMs, now),
    true,
    "an OPEN+authenticated connection with no delivery inside maxAgeMs must report STALE, not fresh"
  );
});

test("isLuldHaltSourceStaleForState: OPEN+authenticated WITH a recent delivery is fresh", () => {
  const now = 1_000_000;
  const maxAgeMs = 120_000;
  const localFreshestAt = now - 5_000; // 5s ago — well inside the window
  assert.equal(
    isLuldHaltSourceStaleForState(true, localFreshestAt, null, now - 5_000, maxAgeMs, now),
    false
  );
});

test("isLuldHaltSourceStaleForState: connection not open, but cluster heartbeat fresh -> fresh", () => {
  const now = 1_000_000;
  const maxAgeMs = 120_000;
  const clusterMessageAt = now - 30_000;
  assert.equal(
    isLuldHaltSourceStaleForState(false, 0, clusterMessageAt, 0, maxAgeMs, now),
    false
  );
});

test("isLuldHaltSourceStaleForState: connection not open, cluster stale, own last_message_at fresh -> fresh", () => {
  const now = 1_000_000;
  const maxAgeMs = 120_000;
  const ownLastMessageAt = now - 10_000;
  assert.equal(
    isLuldHaltSourceStaleForState(false, 0, now - 10 * 60_000, ownLastMessageAt, maxAgeMs, now),
    false
  );
});

test("isLuldHaltSourceStaleForState: nothing fresh anywhere -> stale (never-delivered case preserved)", () => {
  const now = 1_000_000;
  const maxAgeMs = 120_000;
  assert.equal(isLuldHaltSourceStaleForState(false, 0, null, 0, maxAgeMs, now), true);
});

test("isLuldHaltSourceStaleForState: connection open but localFreshestAt=0 (never delivered) falls through to other checks", () => {
  const now = 1_000_000;
  const maxAgeMs = 120_000;
  // connectionOpen=true but localFreshestAt=0 means "never delivered locally" — must NOT be
  // treated as fresh just because the socket reports OPEN; must fall through to cluster/own checks.
  assert.equal(
    isLuldHaltSourceStaleForState(true, 0, null, 0, maxAgeMs, now),
    true
  );
});

test("isLuldHaltSourceStaleForState: boundary age === maxAgeMs is stale (isWsUpdatedAtFresh uses strict <, matches UW halt gate)", () => {
  const now = 1_000_000;
  const maxAgeMs = 120_000;
  assert.equal(
    isLuldHaltSourceStaleForState(true, now - maxAgeMs, null, now - maxAgeMs, maxAgeMs, now),
    true
  );
});

test("isLuldHaltSourceStaleForState: clock-skewed future clusterMessageAt is stale, not falsely fresh", () => {
  const now = 1_000_000;
  const maxAgeMs = 120_000;
  const futureClusterAt = now + 60_000;
  assert.equal(
    isLuldHaltSourceStaleForState(false, 0, futureClusterAt, 0, maxAgeMs, now),
    true,
    "a future cluster heartbeat must not read as live via negative age"
  );
});

test("isLuldHaltSourceStaleForState: clock-skewed future localFreshestAt on open connection is stale", () => {
  const now = 1_000_000;
  const maxAgeMs = 120_000;
  assert.equal(
    isLuldHaltSourceStaleForState(true, now + 60_000, null, 0, maxAgeMs, now),
    true,
    "a future local delivery stamp must not read as live on an OPEN socket"
  );
});
