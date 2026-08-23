import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildGexRegime } from "./gex-cross-validation-core";

/**
 * `GexRegime.flip` is documented as "mirrors gex.flip". On SPX it stopped doing so.
 *
 * ROOT CAUSE. `recomputeNearTermGexStrikeTotals` (spx-odte-gex-uw-overlay.ts) re-derives
 * strike_totals, total, call_wall, put_wall and `gex.flip` after the UW 0DTE ladder replaces
 * today's column — and left `gex.regime` untouched. So the served payload carried a flip from the
 * overlaid book beside a regime (its own flip, its posture, and its read sentence) describing the
 * PRE-overlay book.
 *
 * MEASURED ON PROD 2026-08-20:
 *     gex.flip ........ 7893.38
 *     regime.flip ..... 7887.16     (6.22 pts stale)
 *     regime.read ..... "Spot 7,707.98 is below the gamma flip (7,887.15) -> short gamma ..."
 *
 * The delta held across four samples 20s apart AND through a forced rebuild (`?force=1`, 9.5s) —
 * which is what ruled out caching and staleness. The overlay re-runs per request, so it recreated
 * the skew every time.
 *
 * THE 6 POINTS ARE NOT THE RISK. `posture` is `spot >= flip ? long : short`, and long vs short
 * gamma inverts the entire trading interpretation. With spot ~180 pts below both flips the answer
 * was "short" either way, which is exactly why this survived: the visible symptom was a cosmetic
 * mismatch while the latent failure is a WRONG REGIME whenever spot sits between the two flips.
 */

test("REGRESSION: posture and read are derived FROM the flip passed in", () => {
  // The invariant, stated as a property rather than a value: whatever flip goes in is the flip the
  // regime reports and reasons from. A caller cannot update one and leave the other stale.
  const r = buildGexRegime({ spot: 7707.98, flip: 7893.38, callWall: 7800, putWall: 7700 });
  assert.equal(r.flip, 7893.38, "regime.flip must mirror the flip it was built from");
  assert.equal(r.posture, "short", "spot below flip is short gamma");
  assert.match(r.read, /7,893\.38/, "the read must quote the SAME flip, not another one");
  assert.doesNotMatch(r.read, /7,887/, "the pre-overlay flip must not survive anywhere");
});

test("THE CASE THAT ACTUALLY BITES: spot between the two flips flips the regime", () => {
  // This is why the bug mattered. Same spot, two candidate flips 6 pts apart — and the posture,
  // which drives the whole read, inverts.
  const spot = 7890;
  const stale = buildGexRegime({ spot, flip: 7887.16, callWall: 7800, putWall: 7700 });
  const fresh = buildGexRegime({ spot, flip: 7893.38, callWall: 7800, putWall: 7700 });
  assert.equal(stale.posture, "long", "against the stale flip spot reads as LONG gamma");
  assert.equal(fresh.posture, "short", "against the real flip it is SHORT gamma");
  assert.match(stale.read, /range-bound, fade extremes/);
  assert.match(fresh.read, /momentum \/ vol expansion/);
});

test("undetermined flip yields a neutral read, never a guessed posture", () => {
  const r = buildGexRegime({ spot: 7707.98, flip: null, callWall: 7800, putWall: 7700 });
  assert.equal(r.posture, null);
  assert.equal(r.flip, null);
  assert.match(r.read, /undetermined/i);
  // A missing flip must not be narrated into a regime — same class as the vanna fabricated
  // negative: absence of input is not evidence about the market.
  assert.doesNotMatch(r.read, /long gamma|short gamma/);
});

test("a non-positive spot is treated as undetermined, not as 'below the flip'", () => {
  // `spot >= flip` on spot=0 would silently report SHORT gamma for every ticker with no quote.
  const r = buildGexRegime({ spot: 0, flip: 7893.38, callWall: null, putWall: null });
  assert.equal(r.posture, null);
  assert.match(r.read, /undetermined/i);
});

test("walls appear in the read when present and are simply absent when not", () => {
  const withWalls = buildGexRegime({ spot: 7707.98, flip: 7893.38, callWall: 7800, putWall: 7700 });
  assert.match(withWalls.read, /Resistance 7,800/);
  assert.match(withWalls.read, /support 7,700/);
  const bare = buildGexRegime({ spot: 7707.98, flip: 7893.38, callWall: null, putWall: null });
  assert.doesNotMatch(bare.read, /Resistance|support/);
  assert.match(bare.read, /short gamma/, "the verdict survives without walls");
});

test("REGRESSION: the overlay rebuilds the regime after it rewrites the flip", () => {
  // Asserted on source: importing the overlay pulls the UW ladder and Polygon types. The point is
  // that the two assignments travel together — a future edit that updates `flip` alone is exactly
  // the bug this fixes.
  const src = readFileSync(
    join(process.cwd(), "src/lib/providers/spx-odte-gex-uw-overlay.ts"),
    "utf8"
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const fn = code.slice(code.indexOf("recomputeNearTermGexStrikeTotals"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.match(body, /hm\.gex\.flip\s*=/, "the overlay still sets the flip");
  assert.match(body, /hm\.gex\.regime\s*=\s*buildGexRegime\(/, "and must rebuild the regime with it");
});

test("both producers share ONE regime builder — no third copy of the math", () => {
  // The repo has been bitten three times by duplicated logic drifting (hand-copied pinFlip, a
  // second stopword list, a duplicated wall scan). The overlay cannot import polygon-options-gex
  // because that file imports the overlay, so the shared builder lives in the import-free core.
  const gex = readFileSync(join(process.cwd(), "src/lib/providers/polygon-options-gex.ts"), "utf8");
  const overlay = readFileSync(
    join(process.cwd(), "src/lib/providers/spx-odte-gex-uw-overlay.ts"),
    "utf8"
  );
  assert.match(gex, /buildGexRegime/, "polygon-options-gex must delegate, not reimplement");
  assert.match(overlay, /buildGexRegime/, "the overlay must use the same builder");
  // The read strings must exist in exactly one place.
  const core = readFileSync(
    join(process.cwd(), "src/lib/providers/gex-cross-validation-core.ts"),
    "utf8"
  );
  assert.match(core, /range-bound, fade extremes/, "the read text lives in the core");

  // Scoped to computeGexRegime's OWN BODY, not the whole file. The same phrasing appears
  // legitimately in the `regime_flipped` EVENT message (polygon-options-gex.ts:2608), which is a
  // different string for a different purpose — a file-wide assertion failed on it and would have
  // pushed someone to "fix" a non-duplicate. Check the function that was actually de-duplicated.
  const fnStart = gex.indexOf("function computeGexRegime(");
  assert.notEqual(fnStart, -1, "computeGexRegime must still exist");
  const fnBody = gex.slice(fnStart, gex.indexOf("\n}", fnStart));
  assert.doesNotMatch(
    fnBody,
    /range-bound, fade extremes/,
    "the read must not be reimplemented inside computeGexRegime"
  );
  assert.match(fnBody, /buildGexRegime\(/, "it must delegate instead");
});

/**
 * A NULL FLIP IS NOT A NULL REGIME.
 *
 * MEASURED ON PROD 2026-08-20, full RTH session (13:33Z → 19:35Z, ~6 hours):
 *
 *     SPX   flip=null  flip_reason=net_short_everywhere  total=-45.32B  184 strikes
 *     SPY   flip=null  flip_reason=net_short_everywhere  total=-11.91B  270 strikes
 *     QQQ   flip=null  flip_reason=net_short_everywhere  total= -4.67B  288 strikes
 *     NVDA  flip=219.64  flip_reason=resolved            total= +0.96B   67 strikes
 *
 * NVDA resolving throughout is what proves the machinery was healthy — the indices genuinely had
 * no zero-gamma crossing, because dealers were net short at EVERY strike. `net_short_everywhere`
 * is therefore the strongest possible SHORT reading, not an absence of information.
 *
 * The desk reported "regime unavailable" for six hours about a book whose regime was certain, and
 * Largo repeated the core's own sentence — "until the chain prints a clean dealer-gamma profile" —
 * verbatim to members. That phrasing says *wait for data*. The truth was *this is the data*.
 *
 * `insufficient_strikes` must keep reporting undetermined: that one really is an outage.
 */

test("net_short_everywhere yields SHORT posture, not undetermined", () => {
  const r = buildGexRegime({
    spot: 7654.11,
    flip: null,
    callWall: 7700,
    putWall: 7650,
    flipReason: "net_short_everywhere",
  });
  assert.equal(r.posture, "short", "no long-gamma region anywhere is unambiguously short gamma");
  assert.equal(r.flip, null, "but there is still no flip level to quote");
});

test("the read states the structural fact instead of blaming the data", () => {
  const r = buildGexRegime({
    spot: 7654.11,
    flip: null,
    callWall: 7700,
    putWall: 7650,
    flipReason: "net_short_everywhere",
  });
  assert.match(r.read, /net short gamma at EVERY strike/i, "must name the actual structure");
  assert.match(r.read, /short gamma: momentum \/ vol expansion/, "and carry the regime verdict");
  assert.doesNotMatch(
    r.read,
    /until the chain prints/i,
    "must NOT say 'wait for data' about data that arrived and is complete"
  );
  // Walls still travel — they are the tradeable levels when no flip exists.
  assert.match(r.read, /Resistance 7,700/);
  assert.match(r.read, /support 7,650/);
});

test("insufficient_strikes REMAINS undetermined — that one is a real outage", () => {
  // The whole value of flip_reason is that these two are not interchangeable. If a data outage
  // started reporting SHORT, the fix would have traded a silent gap for a fabricated regime.
  const r = buildGexRegime({
    spot: 7654.11,
    flip: null,
    callWall: null,
    putWall: null,
    flipReason: "insufficient_strikes",
  });
  assert.equal(r.posture, null);
  assert.match(r.read, /undetermined/i);
  assert.doesNotMatch(r.read, /net short gamma at EVERY strike/i);
});

test("an omitted reason behaves exactly as before", () => {
  // Opt-in: callers that do not pass flipReason must not change behaviour.
  const r = buildGexRegime({ spot: 7654.11, flip: null, callWall: null, putWall: null });
  assert.equal(r.posture, null);
  assert.match(r.read, /undetermined/i);
});

test("a resolved flip still wins over the reason", () => {
  // Ordering matters: an actual crossing is more specific than any reason code.
  const r = buildGexRegime({
    spot: 217.34,
    flip: 219.64,
    callWall: 225,
    putWall: 210,
    flipReason: "resolved",
  });
  assert.equal(r.posture, "short", "spot below the resolved flip");
  assert.match(r.read, /below the gamma flip \(219\.64\)/);
});

test("REGRESSION: both producers pass the reason through", () => {
  // A fix only one producer gets is precisely the drift this core module was split out to prevent
  // — the overlay recomputes the flip after replacing the 0DTE column, so it must recompute the
  // REASON with it rather than inheriting the pre-overlay book's explanation.
  const gex = readFileSync(join(process.cwd(), "src/lib/providers/polygon-options-gex.ts"), "utf8");
  const overlay = readFileSync(
    join(process.cwd(), "src/lib/providers/spx-odte-gex-uw-overlay.ts"),
    "utf8"
  );
  assert.match(gex, /flipReason\b/, "matrix producer must thread the reason");
  assert.match(gex, /gexFlipDetail\.reason/, "and take it from the detail it already computes");
  assert.match(overlay, /cumulativeGammaFlipDetail/, "overlay must compute the DETAIL");
  assert.match(overlay, /flipReason: flipDetail\.reason/, "and pass its own reason, not a stale one");
});

/**
 * `walls_by_horizon` — the same "two assignments must travel together" property, for the field that
 * answers "where is the wall for the trade I am putting on TODAY".
 *
 * WHAT WAS WRONG. The field was assigned in exactly ONE place, `prunePastExpiriesFromHeatmap`, and
 * that function early-returns the heatmap unchanged when it finds no past expiry columns. Fresh
 * builds already drop `expiry < today` at ingest, so the prune is always a no-op on a fresh build
 * and the field never shipped. Measured on prod 2026-08-22 across SPY, SPX, QQQ, NVDA, MSFT and
 * AAPL: ABSENT on all six, including two matrices already 1.7 hours old.
 *
 * WHY IT MATTERS. The served `call_wall` is a FIFTEEN-expiry aggregate. On SPX 2026-08-20 at spot
 * 7641.16 it read 7800 (+2.1%) while the front expiry alone read 7700 (+0.8%). Without the horizons
 * neither a member nor Largo can name which scope a wall belongs to — the exact ambiguity the field
 * was added to remove.
 */
test("REGRESSION: the fresh matrix build publishes walls_by_horizon, not just the rollover prune", () => {
  const src = readFileSync(
    join(process.cwd(), "src/lib/providers/polygon-options-gex.ts"),
    "utf8"
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

  const buildStart = code.indexOf("async function buildGexHeatmapUncached(");
  assert.notEqual(buildStart, -1, "buildGexHeatmapUncached must still exist");
  const buildBody = code.slice(buildStart, code.indexOf("\n}", buildStart));
  assert.match(
    buildBody,
    /walls_by_horizon:\s*wallsByHorizon\(/,
    "the FRESH build must publish the horizons — the prune path alone never fires on a fresh matrix"
  );

  // The prune path must keep doing it too: it re-derives every other level after dropping settled
  // columns, and a horizon block spanning a settled expiry is worse than none.
  const pruneStart = code.indexOf("export function prunePastExpiriesFromHeatmap(");
  assert.notEqual(pruneStart, -1, "prunePastExpiriesFromHeatmap must still exist");
  const pruneBody = code.slice(pruneStart, code.indexOf("\n}", pruneStart));
  assert.match(pruneBody, /walls_by_horizon:\s*wallsByHorizon\(/, "the rollover prune still recomputes them");
});

test("REGRESSION: the SPX 0DTE overlay recomputes walls_by_horizon alongside the flip it rewrites", () => {
  // Behaviourally covered in spx-odte-gex-uw-overlay.test.ts; asserted on source here for the same
  // reason the regime assertion above is — the risk is a future edit that updates one and not the
  // other, and this function has now been fixed for that exact failure three times (regime,
  // flip_reason, and these horizons). The overlay REPLACES today's 0DTE column, so the 0DTE bucket
  // is the one it definitionally invalidates.
  const src = readFileSync(
    join(process.cwd(), "src/lib/providers/spx-odte-gex-uw-overlay.ts"),
    "utf8"
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const fn = code.slice(code.indexOf("recomputeNearTermGexStrikeTotals"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  assert.match(body, /hm\.gex\.flip\s*=/, "the overlay still sets the flip");
  assert.match(
    body,
    /hm\.gex\.walls_by_horizon\s*=\s*wallsByHorizon\(/,
    "and must recompute the DTE horizons from the overlaid cells"
  );
});

test("the degraded UW fallback matrix deliberately publishes NO horizons", () => {
  // NOT an oversight — do not "complete" this. UW `/spot-exposures/strike` returns an ALL-EXPIRY
  // dealer-gamma ladder with no per-row expiry, and the fallback files every strike under a single
  // synthetic `{ [today]: net }` column. Running wallsByHorizon over that would return the SAME
  // whole-chain wall in the 0DTE, 3DTE and 7DTE buckets and label the first one "0DTE" — asserting
  // a DTE breakdown the source cannot support. An omitted optional field says "not computable
  // here"; three identical buckets would be a fabricated one.
  const src = readFileSync(
    join(process.cwd(), "src/lib/providers/polygon-options-gex.ts"),
    "utf8"
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const start = code.indexOf("async function buildGexHeatmapFromUwStrikeExposures(");
  assert.notEqual(start, -1, "the UW fallback must still exist");
  const body = code.slice(start, code.indexOf("\n}", start));
  assert.doesNotMatch(
    body,
    /walls_by_horizon/,
    "the all-expiry UW fallback has no expiry axis to bucket by — leave the field omitted"
  );
});
