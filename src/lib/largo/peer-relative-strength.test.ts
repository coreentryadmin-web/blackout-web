import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { relativeStrengthLeader, largoSymbol } from "./technicals";

/**
 * Largo's peer relative-strength tool graded index roots against the EQUITY aggregates namespace,
 * where they do not exist, and then turned the resulting absence into a verdict.
 *
 * Two independent defects compounded:
 *
 *   1. `buildPeerRelativeStrength` resolved its subject with `stockSymbol()`, which strips the
 *      `I:` prefix — so SPX/VIX went to /v2/aggs/ticker/SPX/..., which Polygon answers with
 *      HTTP 200, status "OK" and ZERO results. Not an error; a silent empty success.
 *      Probed live 2026-08-19 on BOTH providers (api.massive.com and api.polygon.io):
 *
 *        SPY   status OK, 6 bars      I:SPX  6 bars
 *        SPX   status OK, 0 bars      I:VIX  6 bars
 *        VIX   status OK, 0 bars
 *
 *   2. The verdict substituted 0% for a MISSING return:
 *        (stockD10 ?? 0) > (peerD10 ?? 0) ? "outperforming" : "lagging"
 *      With no bars, every return is null, so the answer was decided entirely by the sign of
 *      SPY's 10-day move — "lagging" in an up tape, "outperforming" in a down one. Confidently
 *      wrong, and indistinguishable from a real read by whoever asked.
 *
 * `buildLargoTechnicals` in the same file already branched on the index namespace correctly;
 * only this function did not. Same root cause as the Helix index-signal grading fix (#2371).
 */

test("REGRESSION: a missing return never becomes a verdict", () => {
  // This is the exact shape an index subject produced: no bars -> null return.
  assert.equal(relativeStrengthLeader(null, 2.5), null, "no stock data must not read as 'lagging'");
  assert.equal(relativeStrengthLeader(null, -2.5), null, "no stock data must not read as 'outperforming'");
  assert.equal(relativeStrengthLeader(1.2, null), null, "no peer data must not read as a verdict");
  assert.equal(relativeStrengthLeader(null, null), null);
});

test("REGRESSION: the old rule decided the answer from the PEER's sign alone", () => {
  // Demonstrates why null (not a default) is the only honest output: with the subject unknown,
  // the legacy expression flips purely on whether SPY happened to be up or down.
  const legacy = (s: number | null, p: number | null) => ((s ?? 0) > (p ?? 0) ? "outperforming" : "lagging");
  assert.equal(legacy(null, 2.5), "lagging");
  assert.equal(legacy(null, -2.5), "outperforming");
  // Same unknown subject, opposite verdicts. The fixed rule refuses both.
  assert.equal(relativeStrengthLeader(null, 2.5), relativeStrengthLeader(null, -2.5));
});

test("a real comparison still grades, including the boundary", () => {
  assert.equal(relativeStrengthLeader(5.1, 2.0), "outperforming");
  assert.equal(relativeStrengthLeader(-1.0, 2.0), "lagging");
  assert.equal(relativeStrengthLeader(-5.0, -1.0), "lagging", "less negative peer still leads");
  assert.equal(relativeStrengthLeader(-1.0, -5.0), "outperforming");
  // Ties are not "outperforming" — strictly greater, matching the shipped comparison.
  assert.equal(relativeStrengthLeader(2.0, 2.0), "lagging");
  // Zero is a measured return, not a missing one, and must be treated as data.
  assert.equal(relativeStrengthLeader(0, -1), "outperforming");
  assert.equal(relativeStrengthLeader(0, 1), "lagging");
});

test("largoSymbol routes index roots to the I: namespace and leaves equities alone", () => {
  assert.equal(largoSymbol("SPX"), "I:SPX");
  assert.equal(largoSymbol("VIX"), "I:VIX");
  assert.equal(largoSymbol("spx"), "I:SPX", "input is normalized");
  assert.equal(largoSymbol(" vix "), "I:VIX");
  for (const t of ["AAPL", "SPY", "QQQ", "NVDA"]) {
    assert.equal(largoSymbol(t), t, `${t} is an equity and must stay on the equity path`);
  }
});

test("the peer-RS builder actually branches on the index namespace", () => {
  // Asserted on source: the alternative is standing up Polygon to observe one endpoint choice.
  // Comments are stripped first — this file and the fix both NAME the removed call in prose,
  // and a guard that matches its own explanation is a guard that fails for the wrong reason.
  const raw = readFileSync(join(process.cwd(), "src/lib/largo/technicals.ts"), "utf8");
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

  const fn = codeOnly.slice(codeOnly.indexOf("export async function buildPeerRelativeStrength"));
  const body = fn.slice(0, fn.indexOf("export async function buildSeasonality"));

  assert.match(body, /fetchIndexDailyBars/, "an index subject must use the index bars endpoint");
  assert.match(body, /relativeStrengthLeader\(/, "the verdict must go through the honest helper");
  assert.doesNotMatch(
    body,
    /\?\?\s*0\s*\)\s*>/,
    "the ?? 0 default that manufactured a verdict must not come back"
  );
});

test("the null verdict is rendered as a gap, not as the string 'null'", () => {
  const raw = readFileSync(join(process.cwd(), "src/lib/bie/technicals-read.ts"), "utf8");
  const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  assert.match(codeOnly, /rs\.leading \?\?/, "the consumer must handle a null verdict");
  assert.doesNotMatch(codeOnly, /\$\{rs\.leading\}/, "a null verdict must never be interpolated raw");
});
