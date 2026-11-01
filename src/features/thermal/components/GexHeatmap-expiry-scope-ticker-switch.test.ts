/**
 * Regression: switching tickers must let the new ticker re-resolve its OWN default expiry
 * scope (nearest expiry), the same way the FIRST ticker the component ever mounted with does.
 *
 * #2103 ("scope the whole Key Levels row to one expiry, defaulting to nearest") made
 * `expiryScope` resolve from the initial "all" to `expiries[0]` (the nearest expiry) once the
 * live expiry axis is known — guarded by a one-shot `scopeResolvedRef` so a member's own pick
 * is never clobbered on a later render. Separately, and predating that feature, a ticker-switch
 * effect resets `expiryScope` back to "all" on every ticker change (Rank 5 — "a per-expiry chip
 * from the previous ticker would be stale against the new one").
 *
 * Those two effects were never reconciled: `scopeResolvedRef` was only ever set, never cleared,
 * so the "all" -> nearest-expiry resolution fired exactly ONCE in the component's lifetime (for
 * the first ticker it mounted with). Every subsequent ticker switch reset `expiryScope` to "all"
 * via the Rank-5 effect, but with the guard permanently tripped, the resolution effect's
 * `!scopeResolvedRef.current && expiryScope === "all"` branch never ran again — so every ticker
 * after the first stayed on the unscoped near-term aggregate (Key Levels/profile/curve) instead
 * of defaulting to ITS nearest expiry, exactly the two-books-at-once defect #2103 was written to
 * remove, just reintroduced one ticker switch later.
 *
 * This test extracts BOTH effect bodies verbatim from the component source and replays them in
 * the real order a ticker switch fires them (ticker-reset effect, then a fresh-data resolution
 * pass), using a plain-object stand-in for the refs/state setters — so it exercises the actual
 * shipped control flow rather than a hand-written mirror that could silently drift from it.
 *
 * Run: `npx tsx --experimental-test-module-mocks --test src/features/thermal/components/GexHeatmap-expiry-scope-ticker-switch.test.ts`
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/features/thermal/components/GexHeatmap.tsx"), "utf8");

/** Extracts a useEffect body between two exact anchor strings, verbatim. */
function extractEffectBody(startAnchor: string, endAnchor: string): string {
  const start = src.indexOf(startAnchor);
  assert.ok(start > 0, `anchor not found: ${startAnchor}`);
  const bodyStart = start + startAnchor.length;
  const end = src.indexOf(endAnchor, bodyStart);
  assert.ok(end > bodyStart, `end anchor not found after start: ${endAnchor}`);
  return src.slice(bodyStart, end);
}

function extractTickerResetBody(): string {
  return extractEffectBody(
    "// Reset throttle + force state when the ticker changes so a switch starts clean.",
    "}, [ticker]);"
  ).replace(/^[\s\S]*?useEffect\(\(\) => \{/, "");
}

function extractScopeResolutionBody(): string {
  return extractEffectBody(
    "if (expiries.length === 0) return;",
    "}, [expiries, expiryScope]);"
  ).replace(/\}\)\s*;\s*$/, "");
}

test("GexHeatmap: the ticker-reset effect still resets scopeResolvedRef (not just expiryScope)", () => {
  const body = extractTickerResetBody();
  assert.match(
    body,
    /scopeResolvedRef\.current\s*=\s*false\s*;/,
    "the ticker-switch effect must re-arm scopeResolvedRef so the next ticker can resolve its own nearest-expiry default"
  );
});

/**
 * Builds a simulated harness that replays the TWO real effects in the order a ticker switch
 * fires them: (1) the ticker-reset effect whenever `ticker` changes, (2) the scope-resolution
 * effect whenever `expiries`/`expiryScope` change (modeling React re-running it after new data
 * lands). `scopeResolvedRef` and `expiryScope` are plain mutable state the harness threads
 * through both bodies exactly as the component's closures would.
 */
function runTickerSwitchSimulation(tickers: { ticker: string; expiries: string[] }[]): string[] {
  const resolvedScopesPerTicker: string[] = [];
  const state = { expiryScope: "all" as string, scopeResolvedRef: { current: false } };

  const setExpiryScope = (v: string) => {
    state.expiryScope = v;
  };

  const tickerResetFn = new Function(
    "state",
    "setExpiryScope",
    `const scopeResolvedRef = state.scopeResolvedRef;
     const lastForceAtRef = { current: 0 };
     const setForceNonce = () => {};
     const setFastFlash = () => {};
     ${extractTickerResetBody()}`
  );

  const scopeResolutionFn = new Function(
    "expiries",
    "state",
    "setExpiryScope",
    `const scopeResolvedRef = state.scopeResolvedRef;
     const expiryScope = state.expiryScope;
     ${extractScopeResolutionBody()}`
  );

  for (const { expiries } of tickers) {
    // (1) ticker changed -> the Rank-5 reset effect fires.
    tickerResetFn(state, setExpiryScope);
    // (2) fresh data for the new ticker lands -> the resolution effect fires against it.
    scopeResolutionFn(expiries, state, setExpiryScope);
    resolvedScopesPerTicker.push(state.expiryScope);
  }
  return resolvedScopesPerTicker;
}

test("expiryScope: EVERY ticker switch resolves to its own nearest expiry, not just the first", () => {
  const resolved = runTickerSwitchSimulation([
    { ticker: "SPY", expiries: ["2026-11-03", "2026-11-05"] },
    { ticker: "NVDA", expiries: ["2026-11-06", "2026-11-13"] },
    { ticker: "TSLA", expiries: ["2026-11-07", "2026-11-14"] },
  ]);
  assert.deepEqual(
    resolved,
    ["2026-11-03", "2026-11-06", "2026-11-07"],
    "each ticker must resolve to ITS OWN nearest expiry, not stay stuck on \"all\" after the first ticker"
  );
});
