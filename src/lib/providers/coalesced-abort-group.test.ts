import { test } from "node:test";
import assert from "node:assert/strict";
import { createCoalescedRequestGroup } from "./coalesced-abort-group";

/** A run() that only settles when the test explicitly resolves/rejects it. */
function deferredRun<T>(): {
  run: (signal: AbortSignal) => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
  signalSeen: () => AbortSignal | null;
} {
  let resolveFn!: (v: T) => void;
  let rejectFn!: (e: unknown) => void;
  let seenSignal: AbortSignal | null = null;
  const run = (signal: AbortSignal): Promise<T> => {
    seenSignal = signal;
    return new Promise<T>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });
  };
  return { run, resolve: (v) => resolveFn(v), reject: (e) => rejectFn(e), signalSeen: () => seenSignal };
}

test("A cancels while B still needs the request: the underlying request is NOT aborted, and B still gets the result", async () => {
  const d = deferredRun<string>();
  const group = createCoalescedRequestGroup(d.run);
  const signalA = new AbortController();
  const detachA = group.attach(signalA.signal);
  const detachB = group.attach(); // B has no signal of its own — never voluntarily cancels

  signalA.abort();
  assert.equal(d.signalSeen()!.aborted, false, "B is still attached — the shared request must survive A's cancellation");

  d.resolve("shared-value");
  assert.equal(await group.promise, "shared-value", "B still receives the real result");
  detachA();
  detachB();
});

test("A completes while B cancels: B's later cancellation must not affect A's already-delivered result, and must not throw", async () => {
  const d = deferredRun<string>();
  const group = createCoalescedRequestGroup(d.run);
  const signalB = new AbortController();
  const detachA = group.attach();
  const detachB = group.attach(signalB.signal);

  d.resolve("done");
  const value = await group.promise; // "A completes" — both A and B observe this
  assert.equal(value, "done");

  assert.doesNotThrow(() => signalB.abort()); // "B cancels" AFTER completion
  assert.equal(d.signalSeen()!.aborted, false, "a request that already settled must never be aborted post-hoc");
  detachA();
  detachB();
});

test("A and B cancel simultaneously: the underlying request is aborted exactly once, never double-fires, never throws", async () => {
  const d = deferredRun<string>();
  const group = createCoalescedRequestGroup(d.run);
  const signalA = new AbortController();
  const signalB = new AbortController();
  group.attach(signalA.signal);
  group.attach(signalB.signal);

  let abortEvents = 0;
  d.signalSeen()!.addEventListener("abort", () => {
    abortEvents += 1;
  });

  assert.doesNotThrow(() => {
    signalA.abort();
    signalB.abort();
  });
  assert.equal(abortEvents, 1, "simultaneous last-waiter cancellation must abort the shared request exactly once");
  assert.equal(d.signalSeen()!.aborted, true);
});

test("underlying request rejects: the group's promise rejects with the same error for every attached caller, cancellation aside", async () => {
  const d = deferredRun<string>();
  const group = createCoalescedRequestGroup(d.run);
  const detachA = group.attach();
  const detachB = group.attach();

  d.reject(new Error("upstream 500"));
  await assert.rejects(() => group.promise, /upstream 500/);
  detachA();
  detachB();
});

test("request resolves while cancellation fires: a realistically-timed abort racing a resolution must never abort an already-settled request", async () => {
  // "Realistically-timed" matters here: every real trigger for this group's controller
  // (a wall-timeout's setTimeout, an external AbortController fired by a separate async
  // source) is a macrotask boundary — and JS drains ALL pending microtasks (including this
  // module's own internal `.finally(() => { settled = true })`) before running the next
  // macrotask. So by the time any REAL cancellation trigger fires, `settled` has already
  // been observed. A synchronous `resolve(); abort();` back-to-back with no macrotask gap
  // is not a race any real call site in this codebase can produce — none of them abort
  // from the same synchronous stack frame that resolves the underlying promise — so this
  // test models the boundary with a `setImmediate` gap rather than asserting an ordering
  // JS's own microtask/macrotask semantics cannot provide without one.
  const d = deferredRun<string>();
  const group = createCoalescedRequestGroup(d.run);
  const signalA = new AbortController();
  group.attach(signalA.signal);

  d.resolve("won-the-race");
  await new Promise((r) => setImmediate(r)); // let the internal .finally() microtask drain
  signalA.abort();

  const value = await group.promise;
  assert.equal(value, "won-the-race");
  assert.equal(d.signalSeen()!.aborted, false, "the settled guard must prevent a post-resolution abort");
});

test("caller arrives with an already-aborted signal: net effect is zero waiters immediately, so a sole such caller aborts the request right away", () => {
  const d = deferredRun<string>();
  const group = createCoalescedRequestGroup(d.run);
  const pre = new AbortController();
  pre.abort();

  const detach = group.attach(pre.signal);
  assert.equal(d.signalSeen()!.aborted, true, "an already-aborted sole caller must abort the shared request immediately");
  assert.doesNotThrow(() => detach(), "detach must still be safe (idempotent no-op) even though attach already resolved it");
});

test("caller arrives with an already-aborted signal ALONGSIDE a real still-attached caller: the request survives", () => {
  const d = deferredRun<string>();
  const group = createCoalescedRequestGroup(d.run);
  const real = group.attach(); // no signal — stays attached
  const pre = new AbortController();
  pre.abort();
  group.attach(pre.signal);

  assert.equal(d.signalSeen()!.aborted, false, "a real attached caller must keep the request alive despite a DOA arrival");
  real();
});

test("last waiter cancels: the request survives every detach except the final one", () => {
  const d = deferredRun<string>();
  const group = createCoalescedRequestGroup(d.run);
  const sA = new AbortController();
  const sB = new AbortController();
  const sC = new AbortController();
  group.attach(sA.signal);
  group.attach(sB.signal);
  group.attach(sC.signal);

  sA.abort();
  assert.equal(d.signalSeen()!.aborted, false, "2 of 3 still attached");
  sB.abort();
  assert.equal(d.signalSeen()!.aborted, false, "1 of 3 still attached");
  sC.abort();
  assert.equal(d.signalSeen()!.aborted, true, "the LAST waiter's cancellation must abort the shared request");
});

test("listener cleanup after success: aborting a caller's signal AFTER a successful resolution is a safe no-op", async () => {
  const d = deferredRun<string>();
  const group = createCoalescedRequestGroup(d.run);
  const s = new AbortController();
  group.attach(s.signal);
  d.resolve("ok");
  await group.promise;
  assert.doesNotThrow(() => s.abort());
});

test("listener cleanup after rejection: aborting a caller's signal AFTER the request has already rejected is a safe no-op", async () => {
  const d = deferredRun<string>();
  const group = createCoalescedRequestGroup(d.run);
  const s = new AbortController();
  group.attach(s.signal);
  d.reject(new Error("fail"));
  await group.promise.catch(() => {});
  assert.doesNotThrow(() => s.abort());
});

test("listener cleanup after abort: re-aborting the SAME already-fired signal again does not double-decrement or throw", () => {
  const d = deferredRun<string>();
  const group = createCoalescedRequestGroup(d.run);
  const other = group.attach(); // keeps the group alive so we can observe over-decrement
  const s = new AbortController();
  const detach = group.attach(s.signal);

  s.abort(); // fires onAbort -> detach() once
  assert.equal(d.signalSeen()!.aborted, false, "one real caller (`other`) remains");
  assert.doesNotThrow(() => detach()); // caller's own explicit detach, AFTER the abort already ran it once
  assert.equal(d.signalSeen()!.aborted, false, "the double-detach must not phantom-decrement past the real remaining waiter");
  other();
  assert.equal(d.signalSeen()!.aborted, true, "only now, with the real remaining caller gone, should it abort");
});

test("no negative waiter counts: over-detaching one caller never lets a SECOND caller's detach prematurely abort the request", () => {
  const d = deferredRun<string>();
  const group = createCoalescedRequestGroup(d.run);
  const detachA = group.attach();
  const detachB = group.attach();
  const detachC = group.attach();

  detachA();
  detachA();
  detachA(); // 3x — must count as exactly ONE real decrement, never three
  assert.equal(d.signalSeen()!.aborted, false, "B and C are still attached");

  detachB();
  assert.equal(
    d.signalSeen()!.aborted,
    false,
    "if A's over-detach had gone negative, B's single real detach would have wrongly crossed zero here"
  );

  detachC();
  assert.equal(d.signalSeen()!.aborted, true, "only after every real caller has detached exactly once");
});
