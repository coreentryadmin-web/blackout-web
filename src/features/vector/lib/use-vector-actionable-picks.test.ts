import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { effectivePickBias } from "./vector-pick-effective-bias";
import { vectorPickArchiveResetKey } from "./vector-pick-context-key";
import type { VectorPlayEmit } from "./vector-play-engine";

/**
 * Regression guard (round 306 audit): `useVectorActionablePicks`'s archive-reset key used to be
 * built from the RAW `play?.bias ?? null` instead of the EFFECTIVE (committed) bias.
 *
 * A committed `pivot` play's raw `play.bias` stays `"neutral"` by design — long above the gamma
 * flip, short below, until spot actually commits (see `effectivePickBias`'s own header). This
 * exact raw-vs-effective confusion was already found and fixed twice elsewhere in this same
 * feature for the identical reason: `contract-picks/live/route.ts` (2026-08-29) and
 * `vector-pick-sweep.ts` (server-side sweep). The sibling client hook `useVectorContractPicks`
 * already computes the effective bias correctly
 * (`effectivePickBias(play, emit?.spot, emit?.gammaFlip) ?? play.bias`) — but
 * `useVectorActionablePicks` kept using the raw field for its OWN archive-reset key.
 *
 * Consequence: `contextKey` folds in `bias`, but for a pivot play the headline/callWall/putWall/
 * conviction fields do not change when spot crosses the gamma flip (the headline text is the
 * static "pivot at the N gamma flip — long above / short below", not direction-specific), so a
 * raw-bias key can stay byte-identical across a real long<->short flip. The archive-reset effect
 * (`useEffect(() => { setExcludeOccs([]); setArchivedClosed([]); ... }, [ticker, contextKey])`)
 * then never fires, so `excludeOccs`/`archivedClosed` built against the OLD direction's contracts
 * survive the flip and get merged (`mergeArchivedClosedPicks`) into the CURRENT closed-picks list
 * indefinitely — stale, opposite-direction "Don't buy" cards shown under a freshly-flipped setup.
 *
 * There's no rendering harness in this repo (no renderHook/@testing-library — see
 * use-vector-contract-picks.test.ts's own note), so — matching that established pattern — this
 * both (a) proves the underlying defect class directly against the real, pure
 * `effectivePickBias`/`vectorPickArchiveResetKey` functions the hook composes, and (b) asserts the
 * fix is wired into the hook's own source.
 */

const SRC_PATH = join(process.cwd(), "src/features/vector/lib/use-vector-actionable-picks.ts");

const PIVOT_PLAY = {
  bias: "neutral" as const,
  setup: "pivot" as const,
  conviction: 62,
  grade: "B" as const,
  headline: "SPX · pivot at the 6,500 gamma flip — long above / short below",
  thesis: "test",
  invalidation: "5m close back through 6,500",
  style: "swing" as const,
  starred: [],
};

function pivotEmit(spot: number): VectorPlayEmit {
  return {
    play: PIVOT_PLAY,
    spot,
    callWall: 6550,
    putWall: 6450,
    magnetStrike: 6500,
    gammaFlip: 6500,
    regimePosture: null,
    technicals: null,
    confluenceZones: [],
    darkPoolLevels: [],
  };
}

test("the raw-bias defect class: a committed pivot's long<->short flip is invisible to a key built from raw play.bias", () => {
  // Spot well above the flip (committed long) vs well below it (committed short) — same pivot
  // play object in every other respect (headline/walls/conviction never change on a flip).
  const longCommit = pivotEmit(6560); // > flip * (1 + eps)
  const shortCommit = pivotEmit(6440); // < flip * (1 - eps)

  const rawBiasKeyLong = vectorPickArchiveResetKey(longCommit, 5, longCommit.play.bias);
  const rawBiasKeyShort = vectorPickArchiveResetKey(shortCommit, 5, shortCommit.play.bias);
  // This is the bug, demonstrated directly: raw `play.bias` is "neutral" on BOTH sides of the
  // flip, so a key built from it cannot distinguish a committed-long pivot from a committed-short
  // one — exactly the staleness this fix closes.
  assert.equal(rawBiasKeyLong, rawBiasKeyShort);

  const effectiveLong =
    effectivePickBias(longCommit.play, longCommit.spot, longCommit.gammaFlip) ?? longCommit.play.bias;
  const effectiveShort =
    effectivePickBias(shortCommit.play, shortCommit.spot, shortCommit.gammaFlip) ?? shortCommit.play.bias;
  assert.equal(effectiveLong, "long");
  assert.equal(effectiveShort, "short");

  const effectiveBiasKeyLong = vectorPickArchiveResetKey(longCommit, 5, effectiveLong);
  const effectiveBiasKeyShort = vectorPickArchiveResetKey(shortCommit, 5, effectiveShort);
  // The fix: a key built from the EFFECTIVE bias correctly changes across the flip, so the
  // archive-reset effect fires and stale opposite-direction picks don't survive into the new
  // direction's closed-picks list.
  assert.notEqual(effectiveBiasKeyLong, effectiveBiasKeyShort);
});

test("useVectorActionablePicks: archive-reset `bias` is derived via effectivePickBias, not the raw play.bias alone", () => {
  const src = readFileSync(SRC_PATH, "utf8");
  assert.match(
    src,
    /import\s*\{\s*effectivePickBias\s*\}\s*from\s*"\.\/vector-pick-effective-bias"/,
    "must import effectivePickBias, the same committed-bias helper the sibling " +
      "useVectorContractPicks hook already uses"
  );
  const biasLineMatch = src.match(/const bias = ([^\n]+);/);
  assert.ok(biasLineMatch, "expected a `const bias = ...;` line computing the archive-reset bias");
  assert.match(
    biasLineMatch![1],
    /effectivePickBias\(/,
    "`bias` must be derived from effectivePickBias (the committed direction), not the raw " +
      "`play?.bias` alone — otherwise a committed pivot's long<->short flip never changes the " +
      "archive-reset key (see the pure-function test above for the concrete consequence)"
  );
});
