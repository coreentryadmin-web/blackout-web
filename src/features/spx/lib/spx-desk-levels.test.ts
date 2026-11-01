import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildLevels } from "./spx-desk-levels";

const LEVELS_INPUT = {
  price: 7428.78,
  lod: 7410,
  hod: 7440,
  vwap: 7425,
  pdh: 7435,
  pdl: 7405,
  ema20: 7420,
  ema50: 7415,
  ema200: 7380,
  sma50: 7412,
  sma200: 7370,
  gex_king: 7430,
  max_pain: 7425,
  gamma_flip: 7400,
};

test("buildLevels: King node · GEX anchor is neutral, not unconditional resistance", () => {
  // The anchor is argmax|net_gex| — often the PUT wall (support), sometimes below spot — so it
  // carries no directional meaning (#80).
  const levels = buildLevels(LEVELS_INPUT);
  const king = levels.find((l) => l.label === "King node · GEX anchor");
  assert.ok(king, "King node level must be present when gex_king is set");
  assert.equal(king.kind, "neutral");
});

test("buildLevels: HOD/PDH are resistance, PDL/LOD are support, everything else is neutral — when price sits inside the prior day's range (the common case)", () => {
  const levels = buildLevels(LEVELS_INPUT);
  const kindByLabel = Object.fromEntries(levels.map((l) => [l.label, l.kind]));
  assert.equal(kindByLabel["HOD"], "resistance");
  assert.equal(kindByLabel["PDH"], "resistance");
  assert.equal(kindByLabel["PDL"], "support");
  assert.equal(kindByLabel["LOD"], "support");
  for (const label of ["Max Pain", "γ Flip", "EMA 20", "VWAP", "EMA 50", "SMA 50", "EMA 200", "SMA 200"]) {
    assert.equal(kindByLabel[label], "neutral", `${label} must be neutral`);
  }
});

test("buildLevels: PDH/PDL role-reversal — a broken-down PDL sitting ABOVE price reads resistance, not support (live bug, 2026-10-14)", () => {
  // Live repro: price gapped/dropped below the ENTIRE prior session's range (PDL *and* PDH both
  // above price) — a genuine breakdown day, not a fabricated edge case. PDL was hardcoded
  // "support" even while sitting 67pts overhead; that fed spx-play-confirmations.ts's
  // `structureAligned()` long check and spx-play-mtf.ts's `keyLevelForDirection()` as if a broken
  // prior-day low were still a legitimate long-support node.
  const levels = buildLevels({
    ...LEVELS_INPUT,
    price: 7718.94,
    pdh: 7814.15,
    pdl: 7786.11, // ABOVE price — broken down through, now overhead resistance
    hod: 7789.15,
    lod: 7693.31,
  });
  const kindByLabel = Object.fromEntries(levels.map((l) => [l.label, l.kind]));
  assert.equal(kindByLabel["PDL"], "resistance", "a PDL above price has been broken down through — it is resistance, not support");
  assert.equal(kindByLabel["PDH"], "resistance", "PDH above price and never breached stays resistance, unchanged");
  // HOD/LOD are tautologically bounded by today's own price action and keep their fixed kind.
  assert.equal(kindByLabel["HOD"], "resistance");
  assert.equal(kindByLabel["LOD"], "support");
});

test("buildLevels: PDH/PDL role-reversal — a broken-out PDH sitting BELOW price reads support, not resistance", () => {
  // Mirror case: price gapped above the entire prior session's range. The old resistance (PDH) is
  // now underneath price and reads as support; PDL, further below and also breached, is likewise
  // support, not resistance.
  const levels = buildLevels({
    ...LEVELS_INPUT,
    price: 7500,
    pdh: 7435, // BELOW price — broken out through, now support
    pdl: 7405, // BELOW price — also below the breakout, support
    hod: 7510,
    lod: 7420,
  });
  const kindByLabel = Object.fromEntries(levels.map((l) => [l.label, l.kind]));
  assert.equal(kindByLabel["PDH"], "support", "a PDH below price has been broken out through — it is support, not resistance");
  assert.equal(kindByLabel["PDL"], "support", "PDL further below price is also support");
});

test("buildLevels: sorted descending by value, and null-valued fields are dropped", () => {
  const levels = buildLevels({ ...LEVELS_INPUT, max_pain: null, gamma_flip: null });
  assert.ok(!levels.some((l) => l.label === "Max Pain"));
  assert.ok(!levels.some((l) => l.label === "γ Flip"));
  for (let i = 1; i < levels.length; i++) {
    assert.ok((levels[i - 1].value ?? 0) >= (levels[i].value ?? 0), "levels must be sorted descending");
  }
});

test("DRIFT GUARD: both spx-desk.ts and spx-desk-merge.ts import buildLevels from this shared module, never redefine it locally", () => {
  // #80 fixed the King node's `kind` to "neutral" in spx-desk-merge.ts's OWN copy of buildLevels()
  // only — spx-desk.ts kept an independent copy hardcoded to "resistance", so the initial
  // server-side desk build disagreed with the client-side pulse/flow merge for the same field,
  // flipping the King node's label on the first live merge with no price move to justify it.
  // Both files now import the single implementation here instead of each keeping their own copy —
  // this guard fails loudly if either file's own drift-in-two-places bug is ever reintroduced.
  for (const file of ["spx-desk.ts", "spx-desk-merge.ts"]) {
    const src = readFileSync(join(process.cwd(), "src/features/spx/lib", file), "utf8");
    assert.match(
      src,
      /import\s*\{\s*buildLevels\s*\}\s*from\s*"\.\/spx-desk-levels"/,
      `${file} must import buildLevels from ./spx-desk-levels, not redefine it locally`
    );
    assert.doesNotMatch(
      src,
      /^(export\s+)?function buildLevels\(/m,
      `${file} must not define its own buildLevels`
    );
  }
});
