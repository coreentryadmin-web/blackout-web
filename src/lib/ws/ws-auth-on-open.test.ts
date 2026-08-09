import { test } from "node:test";
import assert from "node:assert/strict";
import { authOnOpen, WS_AUTH_RETRY_MS } from "./ws-auth-on-open";

/** Controllable timer so the retry can be driven without waiting 3 real seconds. */
function fakeTimer() {
  const pending: Array<{ id: number; fn: () => void; ms: number; cancelled: boolean }> = [];
  let next = 1;
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = next++;
      pending.push({ id, fn, ms, cancelled: false });
      return id;
    },
    clearTimer: (h: unknown) => {
      const e = pending.find((p) => p.id === h);
      if (e) e.cancelled = true;
    },
    fire: () => {
      for (const e of pending) if (!e.cancelled) e.fn();
    },
    delays: () => pending.map((p) => p.ms),
  };
}

test("sends auth immediately on open", () => {
  const t = fakeTimer();
  let sends = 0;
  authOnOpen({
    send: () => sends++,
    isAuthenticated: () => false,
    isCurrentAndOpen: () => true,
    setTimer: t.setTimer,
    clearTimer: t.clearTimer,
  });
  assert.equal(sends, 1, "the whole point: auth is driven by OUR open, not by a server frame");
});

test("does not re-send once the server has acked", () => {
  const t = fakeTimer();
  let sends = 0;
  let authed = false;
  authOnOpen({
    send: () => sends++,
    isAuthenticated: () => authed,
    isCurrentAndOpen: () => true,
    setTimer: t.setTimer,
    clearTimer: t.clearTimer,
  });
  authed = true; // auth_success arrived
  t.fire();
  assert.equal(sends, 1, "a healthy connection must never send a duplicate auth frame");
});

test("re-sends once when the first auth produced no ack", () => {
  // The safety net that makes deleting the old frame-gated send non-regressive: if a provider ever
  // ignored auth sent before it announced `connected`, this is what still authenticates us.
  const t = fakeTimer();
  let sends = 0;
  authOnOpen({
    send: () => sends++,
    isAuthenticated: () => false,
    isCurrentAndOpen: () => true,
    setTimer: t.setTimer,
    clearTimer: t.clearTimer,
  });
  t.fire();
  assert.equal(sends, 2);
  assert.deepEqual(t.delays(), [WS_AUTH_RETRY_MS]);
});

test("never sends on a socket that has been superseded or closed", () => {
  // A retry landing on the wrong socket after a reconnect is the failure this guard exists for.
  const t = fakeTimer();
  let sends = 0;
  let live = true;
  authOnOpen({
    send: () => sends++,
    isAuthenticated: () => false,
    isCurrentAndOpen: () => live,
    setTimer: t.setTimer,
    clearTimer: t.clearTimer,
  });
  assert.equal(sends, 1);
  live = false; // socket replaced by a reconnect
  t.fire();
  assert.equal(sends, 1, "the retry must not fire against a dead or replaced socket");
});

test("does not send at all if the socket is already gone when open fires", () => {
  const t = fakeTimer();
  let sends = 0;
  authOnOpen({
    send: () => sends++,
    isAuthenticated: () => false,
    isCurrentAndOpen: () => false,
    setTimer: t.setTimer,
    clearTimer: t.clearTimer,
  });
  t.fire();
  assert.equal(sends, 0);
});

test("cancel() stops a pending retry", () => {
  const t = fakeTimer();
  let sends = 0;
  const cancel = authOnOpen({
    send: () => sends++,
    isAuthenticated: () => false,
    isCurrentAndOpen: () => true,
    setTimer: t.setTimer,
    clearTimer: t.clearTimer,
  });
  cancel();
  t.fire();
  assert.equal(sends, 1, "teardown must be able to disarm the retry");
});
