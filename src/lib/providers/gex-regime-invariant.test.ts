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
