import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression: peekSpxDesk can return a bootstrap shell with price:0 before buildSpxDesk
 * finishes. The route must not short-circuit on that — members would see SPX 0 while
 * sibling surfaces (gex-heatmap) already serve a grounded spot.
 */
test("spx/desk route: peek fast-path requires price > 0", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/market/spx/desk/route.ts"), "utf8");
  assert.match(
    src,
    /if \(instant && instant\.price > 0 && instant\.source !== "none"\)/,
    "must not return peek cache when price is zero (bootstrap shell) or source is \"none\""
  );
  assert.doesNotMatch(
    src,
    /if \(instant\) \{\s*\n\s*return NextResponse\.json/,
    "bare `if (instant)` would serve price:0 shells"
  );
});

/**
 * Regression: deskShellFromPulse() merges a real nonzero price/availability from the pulse
 * lane into the emptyDeskPayload() degraded shell while leaving `source: "none"` untouched
 * (mergePulseIntoDesk() never reassigns `source`). A `price > 0` check alone is therefore not
 * proof of a real desk build — the route must also require `source !== "none"`, matching the
 * precedent at spx-play-engine.ts (`desk.price > 0 && desk.source !== "none"`).
 */
test("spx/desk route: peek fast-path also requires source !== \"none\" (degraded pulse shell guard)", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/market/spx/desk/route.ts"), "utf8");
  assert.match(
    src,
    /instant\.source !== "none"/,
    "must reject a degraded pulse-only shell (source: \"none\") even when its merged price is nonzero"
  );
});

test("spx/desk route: ServerCacheTimeoutError degrades to 200 (not 502)", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/market/spx/desk/route.ts"), "utf8");
  assert.match(src, /instanceof ServerCacheTimeoutError/);
  assert.match(src, /buildSpxDeskPulseMinimal/);
  assert.match(src, /deskShellFromPulse/);
});

test("spx/desk route: catch block applies the honest degraded fallback for ANY caught error, not just ServerCacheTimeoutError (2026-11-09 fix)", () => {
  // BUG (confirmed live via adversarial source audit, 2026-11-09): the stale-peek ->
  // pulse-minimal-shell fallback chain below was previously gated on
  // `error instanceof ServerCacheTimeoutError` specifically. That class is thrown ONLY when
  // withServerCache's own maxBlockMs/fallback race (server-cache.ts) is fully exhausted — a
  // TIMING fact. It is NOT what reaches this catch block when buildSpxDesk() throws a REAL error
  // FAST (e.g. a provider fetch rejecting on a 403 "not entitled" response well under
  // withServerCache's own timeout budget — see CLAUDE.md's 2026-11-07/08 notes on the live
  // Polygon/Massive real-time-snapshot entitlement outage): that raw error wins
  // withServerCache's internal Promise.race before the ServerCacheTimeoutError path ever
  // engages, so `instanceof ServerCacheTimeoutError` is false and this route fell straight
  // through to a hard 502 — a false outage, confirmed live at 2026-11-09T18:10:31.263Z /
  // 2026-11-09T18:13:00.179Z while the sibling GET /api/market/spx/play returned a graceful 200
  // degraded payload for the exact same root cause at the same moments. This is the exact same
  // bug class already fixed the same day at /api/market/spx/play (PR #7791) — this test guards
  // the desk route's own copy of it.
  const src = readFileSync(join(process.cwd(), "src/app/api/market/spx/desk/route.ts"), "utf8");
  const catchBlock = src.match(/\} catch \(error\) \{[\s\S]*$/);
  assert.ok(catchBlock, "GET's catch block present");
  const body = catchBlock![0];

  // The OLD gated form must be gone — this is the entire bug. A regression that reintroduces an
  // `if (error instanceof ServerCacheTimeoutError) { ... }` wrapper around the stale-peek /
  // pulse-minimal-shell fallback would silently reopen the exact live gap this test guards
  // against, even while still matching the other (pre-existing, "does this string appear
  // anywhere") ServerCacheTimeoutError assertion in the test above.
  assert.doesNotMatch(
    body,
    /if \(error instanceof ServerCacheTimeoutError\)\s*\{\s*\n\s*const stalePeek/,
    "the stale-peek fallback must not be gated on error instanceof ServerCacheTimeoutError"
  );

  // The NEW unconditional form must be present: the stale-peek -> pulse-minimal-shell chain runs
  // for every caught error, inside its own try block (so a fallback-chain failure still has a
  // controlled, terminal 502 rather than escaping as an uncaught 500).
  assert.match(
    body,
    /try \{\s*\n\s*const stalePeek = await peekSpxDesk\(\)\.catch\(\(\) => null\);/,
    "the stale-peek fallback must run unconditionally, inside a try block, for every caught error"
  );
  assert.match(
    body,
    /const shell = deskShellFromPulse\(await buildSpxDeskPulseMinimal\(\)\);/,
    "the pulse-minimal-shell fallback must still be present and reachable unconditionally"
  );

  // The literal 502 must still exist, but ONLY as the inner catch's last-resort response (i.e.
  // reached when the fallback chain itself throws), not as the direct sibling of the removed
  // `if` gate.
  assert.match(
    body,
    /\} catch \(fallbackError\) \{[\s\S]*status: 502/,
    "the hard 502 must only be reachable when the fallback chain itself throws"
  );

  // ServerCacheTimeoutError may still be referenced for diagnostic/log purposes (CloudWatch
  // triage) — the earlier test in this file still requires the string to appear somewhere — but
  // it must no longer gate whether the honest fallback is applied.
  assert.match(src, /instanceof ServerCacheTimeoutError/);
});
