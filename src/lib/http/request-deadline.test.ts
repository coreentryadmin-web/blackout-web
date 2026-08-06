import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALB_IDLE_TIMEOUT_MS,
  DEADLINE_HEADROOM_MS,
  MAX_EFFECTIVE_DEADLINE_MS,
  MIN_EFFECTIVE_DEADLINE_MS,
  deadlineExceededBody,
  isOverDeclared,
  resolveRequestDeadlineMs,
  withRequestDeadline,
  type DeadlineTimeoutInfo,
} from "./request-deadline";

test("the effective ceiling is strictly below the ALB idle timeout", () => {
  // The whole point is to WIN the race against the ALB. If this ever inverts, the
  // client goes back to receiving an opaque load-balancer 504 with no log line.
  assert.ok(MAX_EFFECTIVE_DEADLINE_MS < ALB_IDLE_TIMEOUT_MS);
  assert.equal(MAX_EFFECTIVE_DEADLINE_MS, ALB_IDLE_TIMEOUT_MS - DEADLINE_HEADROOM_MS);
});

test("a declaration inside the ceiling is honoured verbatim", () => {
  const r = resolveRequestDeadlineMs(30);
  assert.equal(r.effectiveMs, 30_000);
  assert.equal(r.declaredMs, 30_000);
  assert.equal(r.clamped, false);
  assert.equal(r.reason, "declared");
});

test("60s and 90s declarations (the common cases) pass through unclamped", () => {
  for (const s of [10, 30, 60, 90]) {
    const r = resolveRequestDeadlineMs(s);
    assert.equal(r.effectiveMs, s * 1000, `${s}s should be honoured`);
    assert.equal(r.clamped, false);
  }
});

test("a 120s declaration is clamped — it exactly races the ALB and would lose", () => {
  const r = resolveRequestDeadlineMs(120);
  assert.equal(r.clamped, true);
  assert.equal(r.reason, "clamped_to_alb");
  assert.equal(r.effectiveMs, MAX_EFFECTIVE_DEADLINE_MS);
  assert.equal(r.declaredMs, 120_000);
});

test("the over-declared routes are all clamped to the ALB ceiling", () => {
  // 3x180s, 6x300s, 2x800s in src/app/api/**/route.ts as of 2026-08-06.
  for (const s of [180, 300, 800]) {
    const r = resolveRequestDeadlineMs(s);
    assert.equal(r.clamped, true, `${s}s must be reported as unachievable`);
    assert.equal(r.effectiveMs, MAX_EFFECTIVE_DEADLINE_MS);
    assert.equal(r.declaredMs, s * 1000);
  }
});

test("isOverDeclared separates achievable from aspirational declarations", () => {
  assert.equal(isOverDeclared(10), false);
  assert.equal(isOverDeclared(60), false);
  assert.equal(isOverDeclared(115), false);
  assert.equal(isOverDeclared(120), true);
  assert.equal(isOverDeclared(800), true);
});

test("a missing declaration defaults to the ALB-beating maximum", () => {
  for (const v of [undefined, null]) {
    const r = resolveRequestDeadlineMs(v);
    assert.equal(r.effectiveMs, MAX_EFFECTIVE_DEADLINE_MS);
    assert.equal(r.declaredMs, null);
    assert.equal(r.clamped, false);
    assert.equal(r.reason, "defaulted");
  }
});

test("a non-finite declaration defaults rather than producing NaN", () => {
  for (const v of [NaN, Infinity, -Infinity]) {
    const r = resolveRequestDeadlineMs(v);
    assert.equal(r.effectiveMs, MAX_EFFECTIVE_DEADLINE_MS);
    assert.equal(r.reason, "defaulted");
  }
});

test("zero or negative declarations are raised to the floor, not honoured", () => {
  // A 0 would otherwise produce a handler that times out before it starts.
  for (const v of [0, -5]) {
    const r = resolveRequestDeadlineMs(v);
    assert.equal(r.effectiveMs, MIN_EFFECTIVE_DEADLINE_MS);
    assert.equal(r.reason, "raised_to_floor");
  }
});

test("the 504 body names the route and flags an unachievable declaration", () => {
  const body = deadlineExceededBody({
    route: "GET /api/market/example",
    elapsedMs: 115_001,
    effectiveMs: 115_000,
    declaredMs: 800_000,
    clamped: true,
  });
  assert.equal(body.error, "deadline_exceeded");
  assert.equal(body.route, "GET /api/market/example");
  assert.equal(body.declared_unachievable, true);
  assert.equal(body.declared_ms, 800_000);
  assert.equal(body.deadline_ms, 115_000);
});

test("a handler that finishes in time is returned untouched", async () => {
  const wrapped = withRequestDeadline(
    { route: "GET /fast", maxDurationSeconds: 30 },
    async () => new Response("ok", { status: 200 })
  );
  const res = await wrapped(new Request("https://example.test/fast"));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "ok");
});

test("a handler that overruns yields a 504 with a diagnostic body", async () => {
  const seen: DeadlineTimeoutInfo[] = [];
  const wrapped = withRequestDeadline(
    {
      route: "GET /slow",
      // 1s declared is raised to the 1s floor; keeps the test fast while still
      // exercising the real timer path.
      maxDurationSeconds: 1,
      onTimeout: (info) => seen.push(info),
    },
    async () => {
      await new Promise((r) => setTimeout(r, 5_000));
      return new Response("never", { status: 200 });
    }
  );

  const res = await wrapped(new Request("https://example.test/slow"));
  assert.equal(res.status, 504);
  assert.equal(res.headers.get("cache-control"), "no-store");

  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.error, "deadline_exceeded");
  assert.equal(body.route, "GET /slow");
  assert.equal(body.deadline_ms, 1_000);

  assert.equal(seen.length, 1);
  assert.equal(seen[0].route, "GET /slow");
});

test("the deadline aborts the context signal so upstream work is cancelled", async () => {
  let aborted = false;
  const wrapped = withRequestDeadline(
    { route: "GET /abort", maxDurationSeconds: 1, onTimeout: () => {} },
    async (_req, ctx) => {
      ctx.signal.addEventListener("abort", () => {
        aborted = true;
      });
      await new Promise((r) => setTimeout(r, 5_000));
      return new Response("never");
    }
  );

  const res = await wrapped(new Request("https://example.test/abort"));
  assert.equal(res.status, 504);
  // Without this, a timed-out handler keeps holding a connection and a
  // rate-limiter slot on behalf of a client that is already gone.
  assert.equal(aborted, true);
});

test("the context exposes a shrinking remaining budget", async () => {
  let firstRemaining = 0;
  let secondRemaining = 0;

  const wrapped = withRequestDeadline(
    { route: "GET /budget", maxDurationSeconds: 10 },
    async (_req, ctx) => {
      firstRemaining = ctx.remainingMs();
      await new Promise((r) => setTimeout(r, 60));
      secondRemaining = ctx.remainingMs();
      return new Response("ok");
    }
  );

  await wrapped(new Request("https://example.test/budget"));
  assert.ok(firstRemaining <= 10_000 && firstRemaining > 9_000);
  assert.ok(secondRemaining < firstRemaining, "remaining budget must shrink");
});

test("extra Next router args are forwarded and the context lands last", async () => {
  const wrapped = withRequestDeadline<[{ params: { id: string } }]>(
    { route: "GET /route/:id", maxDurationSeconds: 30 },
    async (_req, routeCtx, deadlineCtx) => {
      assert.equal(routeCtx.params.id, "abc");
      assert.ok(deadlineCtx.signal instanceof AbortSignal);
      return new Response("ok");
    }
  );

  const res = await wrapped(new Request("https://example.test/route/abc"), {
    params: { id: "abc" },
  });
  assert.equal(res.status, 200);
});

test("a handler that throws still propagates its error, not a 504", async () => {
  const wrapped = withRequestDeadline(
    { route: "GET /throws", maxDurationSeconds: 30 },
    async () => {
      throw new Error("boom");
    }
  );
  await assert.rejects(() => wrapped(new Request("https://example.test/throws")), /boom/);
});
