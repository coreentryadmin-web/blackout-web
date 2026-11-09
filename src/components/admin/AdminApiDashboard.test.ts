import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Why this is a SOURCE-level test, not a rendered-behavior one: this component has no
// server-only import and could in principle be exercised with a real renderer, but this repo
// carries no DOM/React-renderer test infra (no jsdom, no @testing-library/react, no
// react-test-renderer — confirmed via package.json/node_modules before writing this). The repo's
// own established fallback for a hook-wiring invariant that can't be driven through a real
// render is a direct regex assertion against the component source (e.g.
// AccountMembershipPanel.test.tsx's `assert.doesNotMatch(html, ...)` / `<a href="/upgrade">`
// source check, and largo-tool-labels.test.ts's completeness check against the live source) —
// same approach here.
const source = readFileSync(
  fileURLToPath(new URL("./AdminApiDashboard.tsx", import.meta.url)),
  "utf8"
);

function depsOf(fnSourceSnippetStart: string): string[] {
  const start = source.indexOf(fnSourceSnippetStart);
  assert.notEqual(start, -1, `could not locate "${fnSourceSnippetStart}" in AdminApiDashboard.tsx`);
  // Walk forward from the snippet to the matching `}, [...]);` that closes this useCallback —
  // the body contains its own nested `}` (try/catch/finally), so find the FIRST `}, [` after the
  // snippet rather than assuming the very next `}` closes the callback.
  const closeIdx = source.indexOf("}, [", start);
  assert.notEqual(closeIdx, -1, `could not find the deps array closing "${fnSourceSnippetStart}"`);
  const depsStart = closeIdx + "}, [".length;
  const depsEnd = source.indexOf(")", source.indexOf("]", depsStart));
  const raw = source.slice(depsStart, source.indexOf("]", depsStart));
  void depsEnd;
  return raw
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
}

test("AdminApiDashboard's load() must not depend on its own fetched `data` state", () => {
  // THE BUG (round 503): `load` used to read `data` directly (`else if (!data) setLoading(true)`)
  // and list `[data]` as its useCallback dependency. `setData` runs on EVERY successful poll (the
  // 8s telemetry tick AND the 120s probe tick) and always hands back a freshly-parsed JSON object,
  // so `data`'s reference changes on every single successful load — which meant `load` itself got
  // a brand-new identity after every load, not just the first one.
  //
  // The polling-setup effect a few lines below depends on `[load]` (`useEffect(() => { load(true);
  // setInterval(...); setInterval(...); }, [load])`), so a `load` identity change tore the two
  // intervals down and immediately re-ran the effect body — which calls `load(true)` SYNCHRONOUSLY
  // again. That is the EXPENSIVE probe path (`?probe=1`, which makes real round-trip calls to
  // Polygon/UW/the engine/Postgres per src/lib/admin-api-dashboard.ts and writes an admin-audit-log
  // row every time per the dashboard route), so instead of the intended "cheap telemetry every 8s,
  // expensive live probe every 120s" cadence, the probe fired on effectively every successful poll
  // — a tight, self-sustaining loop bounded only by round-trip latency, not the schedule. Every
  // sibling admin dashboard in this file avoids this shape deliberately (AdminCronDashboard's own
  // `load` depends on SWR's stable `refresh`, never on the data it fetched;
  // AdminOperationsDashboard/AdminXMarketingPanel/AdminNightHawkDashboard's `load`s take no
  // dependency on their own fetched state either) — this file was the one outlier.
  //
  // THE FIX: track "has any load ever landed" in a ref (`hasDataRef`) instead of reading `data`
  // state directly, so `load`'s own identity never depends on the very state it writes.
  const loadDeps = depsOf("const load = useCallback(async (withProbe = false) => {");
  assert.ok(
    !loadDeps.includes("data"),
    `load()'s useCallback deps must not include "data" (found deps: [${loadDeps.join(", ")}]) — ` +
      `depending on its own fetched state gives load() a new identity on every successful poll, ` +
      `which re-triggers the effect that wires up the 8s/120s polling intervals and forces the ` +
      `expensive 120s probe path to run on effectively every tick instead.`
  );
});

test("load() reads a ref, not `data` state, to decide the first-load spinner", () => {
  const start = source.indexOf("const load = useCallback(async (withProbe = false) => {");
  const closeIdx = source.indexOf("}, [", start);
  const body = source.slice(start, closeIdx);
  assert.match(
    body,
    /else if \(!hasDataRef\.current\) setLoading\(true\);/,
    "load() must gate the full-page spinner on hasDataRef.current, not on `data` state directly"
  );
  assert.doesNotMatch(
    body,
    /else if \(!data\) setLoading\(true\);/,
    "load() must not read `data` state directly — that is what made load()'s identity unstable"
  );
});
