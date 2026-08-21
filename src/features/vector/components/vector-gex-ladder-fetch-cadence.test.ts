import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The GEX ladder must fetch on its POLL cadence, not on the SSE spot tick.
 *
 * `liveSpot` arrives from the chart's SSE stream at roughly 1Hz (VectorPageShell memoises whole
 * subtrees specifically to survive that churn). Naming it in the fetch effect's dependency array
 * tore the effect down and re-ran it — `void load()` included — on every one of those ticks, so a
 * panel that intends to poll `/api/market/vector/gex-ladder` every 5s (oracle names) or 15s
 * (on-demand names) hit it about once a second instead: 5-15× the intended rate, per open panel,
 * per member, for the whole session.
 *
 * That route is not cheap. Its own header documents a prod measurement of
 * `GET /api/market/vector/gex-ladder?ticker=SPX -> 504 after 121,088ms` on a cold matrix, which is
 * why it carries an 8s deadline; it re-derives per-expiry strike totals on a narrowed horizon and
 * round-trips the whole ladder through `roundFloats`.
 *
 * The client cost was just as real and much better hidden: the 2026-08-01 audit added `memo()` to
 * LadderRow on the stated premise that "`rows` only changes on the ladder poll". Re-fetching every
 * second meant `setLadder` installed freshly-parsed row OBJECTS every second, memo's referential
 * check failed on every row, and the optimisation did nothing at all.
 *
 * This is asserted against the SOURCE because the repo has no jsdom/testing-library harness — the
 * component tests here render through `renderToStaticMarkup`, which never runs an effect, so effect
 * scheduling cannot be observed at runtime. A structural check is what is actually available, and
 * the regression it guards is invisible in every other way: nothing errors, nothing renders wrong,
 * the panel just quietly costs 10× what it should.
 */

const LADDER = join(process.cwd(), "src/features/vector/components/VectorGexLadder.tsx");

/**
 * The dependency array of the `useEffect` containing `marker`.
 *
 * Anchors on a token unique to the target effect, then takes the first `}, [ ... ]);` that closes
 * it — rather than matching dep arrays file-wide, which would also pick up the spot-display effect
 * that is SUPPOSED to depend on liveSpot.
 */
/**
 * Source with comments stripped.
 *
 * Assertions about what the component DOES must not trip over prose that explains what it used to
 * do — the comment recording a removed identifier is documentation, not a live reference. (This
 * test failed on its own first run for exactly that reason.)
 */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

function depsOfEffectContaining(src: string, marker: string): string {
  const at = src.indexOf(marker);
  assert.notEqual(at, -1, `marker ${marker} not found — this test is anchored to stale source`);
  const close = /\}, \[([^\]]*)\]\);/.exec(src.slice(at));
  assert.ok(close, `no dependency array found after ${marker}`);
  return close![1];
}

test("REGRESSION: the ladder fetch effect does not depend on the ~1Hz liveSpot tick", () => {
  const deps = depsOfEffectContaining(codeOnly(readFileSync(LADDER, "utf8")), "vectorWallsScopePollMs(ticker)");

  assert.doesNotMatch(
    deps,
    /\bliveSpot\b/,
    `The fetch effect depends on [${deps.trim()}]. \`liveSpot\` ticks ~1Hz off chart SSE, so every ` +
      "tick re-runs this effect and issues another /api/market/vector/gex-ladder request. Read it " +
      "through liveSpotRef instead — the effect needs its VALUE, not a re-run when it changes."
  );

  // The things it legitimately re-fetches for: a different ticker, a different DTE scope, the
  // session opening or closing, and a caller-supplied cadence override.
  for (const dep of ["ticker", "liveSession", "dteHorizon", "wallsPollMs"]) {
    assert.match(deps, new RegExp(`\\b${dep}\\b`), `${dep} must still re-run the fetch effect`);
  }
});

test("liveSpot is read through a ref inside the fetch effect, so the value stays fresh", () => {
  // Dropping the dep without the ref would be a real bug of its own — `load` would close over the
  // liveSpot from whichever render created the effect, and after a ticker switch it could adopt the
  // response's spot while a live one exists (or refuse to, off-hours). The ref is the load-bearing
  // half of this fix, not incidental cleanup.
  const code = codeOnly(readFileSync(LADDER, "utf8"));
  assert.match(code, /liveSpotRef\s*=\s*useRef<number \| null>\(liveSpot\)/);
  assert.match(code, /liveSpotRef\.current = liveSpot/, "the ref must be kept current on every tick");
  assert.match(code, /if \(!liveSpotRef\.current\)/, "the fetch must read the ref, not the prop");
});

test("the live poll interval is not gated on how recently a fetch landed", () => {
  // The old `Date.now() - lastFetchTimeRef.current > 10_000` gate existed only to blunt the tick
  // storm. With the storm removed it inverts into a worse bug: switch ticker within 10s of the
  // previous fetch and NO interval is created, and since the effect does not re-run again the
  // ladder then never refreshes for the rest of the session.
  const code = codeOnly(readFileSync(LADDER, "utf8"));
  assert.doesNotMatch(code, /lastFetchTimeRef/, "the fetch-recency gate should be gone with its cause");
  assert.match(code, /liveSession \? setInterval\(load, pollMs\) : null/);
});

test("the memo premise LadderRow relies on is stated where it can be broken", () => {
  // LadderRow's memo() is only worth anything while `rows` changes on the poll rather than the
  // tick. That premise lives in a comment two hundred lines from the effect that decides it, and
  // it was silently false for weeks. Keep the pointer.
  const src = readFileSync(LADDER, "utf8");
  assert.match(src, /rows` only changes on the ladder poll/);
  assert.match(src, /Keep\s*\n\/\/ `liveSpot` out of that dep array/);
});
