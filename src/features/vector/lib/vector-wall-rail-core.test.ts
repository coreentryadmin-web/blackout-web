import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beadRangeMeetsTarget,
  BEAD_VISIBLE_MIN_HALF_PX,
  MIN_CLAMPED_HALF_RANGE_PX,
  beadRenderTuning,
  targetHalfPx,
  rowSwellMul,
  wallBeadColorShade,
  FILL_ALPHA_MAX,
  FILL_ALPHA_MIN,
  HALF_PX_MAX,
  HALF_PX_MIN,
  BEAD_TUNING_DEFAULT,
  BEAD_TUNING_COMPARE,
  clampTuningToSpacing,
  closestRowGapPx,
  beadKey,
  beadRenderTuning,
  fillAlpha,
  kingKey,
  kingStrikeByTime,
  maxPctByTime,
  targetHalfPx,
  withA,
  trailingRefs,
  rowPeakRefs,
  rowSwellMul,
  rowStrengthHaloExtraPx,
  ROW_HALO_ROW_GAP_FILL,
  BEAD_ROW_FILL_FOR_TEST,
  rowStrengthHaloAlphaMul,
  beadCenterSpacingPx,
  ROW_HALO_BAR_SPACING_FILL,
  ROW_SWELL_FLOOR,
  MIN_CLAMPED_HALF_RANGE_PX,
} from "./vector-wall-rail-core";

// ── withA ────────────────────────────────────────────────────────────────────

test("withA: expands 6- and 3-digit hex to rgba", () => {
  assert.equal(withA("#ffd60a", 1), "rgba(255, 214, 10, 1)");
  assert.equal(withA("#d97bff", 0.5), "rgba(217, 123, 255, 0.5)");
  // The 3-digit form doubles each nibble: #abc -> aa bb cc.
  assert.equal(withA("#abc", 1), "rgba(170, 187, 204, 1)");
});

test("withA: a MALFORMED hex falls through instead of producing rgba(NaN)", () => {
  // The bug this guards. The old check was startsWith("#") plus a length test, so anything of the
  // right length went to parseInt — and `rgba(NaN, NaN, NaN, 1)` is not a parse error to canvas,
  // it is a NO-OP: fillStyle keeps its previous value. Beads would draw in whatever colour was
  // last set, on the panel whose only job is showing where the walls are.
  for (const bad of ["#gggggg", "#12345z", "#zzz", "#--", "#1234567"]) {
    const out = withA(bad, 1);
    assert.doesNotMatch(out, /NaN/, `withA(${bad}) must not emit NaN`);
    assert.equal(out, bad, "unparseable input is returned as-is for the browser to reject visibly");
  }
});

test("withA: non-hex colours pass through untouched for globalAlpha to carry", () => {
  assert.equal(withA("rgba(1, 2, 3, 0.4)", 0.9), "rgba(1, 2, 3, 0.4)");
  assert.equal(withA("gold", 0.2), "gold");
});

test("withA: alpha is clamped, and a non-finite alpha does not leak into the string", () => {
  assert.equal(withA("#000000", -5), "rgba(0, 0, 0, 0)");
  assert.equal(withA("#000000", 42), "rgba(0, 0, 0, 1)");
  assert.equal(withA("#000000", Number.NaN), "rgba(0, 0, 0, 1)", "NaN alpha falls back to opaque");
});

// ── targetHalfPx ─────────────────────────────────────────────────────────────

test("targetHalfPx: always inside the [MIN, MAX] px band", () => {
  for (const pct of [0, 0.0001, 1, 25, 50, 100, 1e9]) {
    for (const notional of [undefined, 0, -1, 1e3, 1e12]) {
      const r = targetHalfPx(pct, notional, 100);
      assert.ok(
        r >= HALF_PX_MIN - 1e-9 && r <= HALF_PX_MAX + 1e-9,
        `pct=${pct} notional=${notional} -> ${r} outside [${HALF_PX_MIN}, ${HALF_PX_MAX}]`
      );
    }
  }
});

test("targetHalfPx: a bigger wall is never a smaller bead", () => {
  // Monotonicity is the property a member actually reads off the rail. If it inverts anywhere, the
  // biggest wall on screen can render smaller than a lesser one.
  let prev = -Infinity;
  for (const pct of [0.5, 1, 2, 5, 10, 20, 40, 80, 100]) {
    const r = targetHalfPx(pct, undefined, 100);
    assert.ok(r >= prev - 1e-9, `pct=${pct} produced ${r}, smaller than the previous ${prev}`);
    prev = r;
  }
});

test("targetHalfPx: degenerate magnitude still renders a bead, never a collapse", () => {
  // Off-hours / degraded data: no notional and no usable pct. The rail must still draw something.
  for (const pct of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const r = targetHalfPx(pct, undefined, 0);
    assert.ok(Number.isFinite(r), `pct=${pct} produced a non-finite radius`);
    assert.ok(r >= HALF_PX_MIN - 1e-9, `pct=${pct} produced ${r}, below the floor`);
  }
});

// CONTRACT CHANGE 2026-08-17: size comes from the per-ticker SHARE, not absolute dollars.
//
// This test previously asserted the opposite — same pct, bigger notional → bigger bead. That is
// precisely what broke single names: absolute dollars are not comparable across underlyings, so a
// ladder anchored at $200M-$2.5B (calibrated on SPX) clamped 100% of META/TSLA beads to one size.
// Two strikes holding the SAME share of their own book must now render the same, whichever ticker
// they belong to.
test("targetHalfPx: identical share renders identically regardless of absolute $ notional", () => {
  const indexScale = targetHalfPx(10, 1e12, 100); // SPX-scale book
  const singleName = targetHalfPx(10, 1e7, 100); // META-scale book, same 10% share
  assert.ok(
    Math.abs(indexScale - singleName) < 1e-9,
    `same 10% share must draw the same bead (${indexScale} vs ${singleName})`
  );
});

// REGRESSION GUARD for the 2026-08-17 member report ("all beads look the same size" on
// META/NVDA/TSLA). Measured live: the absolute ladder put 100% of META and TSLA beads at the floor
// with exactly ONE distinct size, 93.2% of NVDA at the floor with four. Feed each ticker its OWN
// measured share distribution and require the size channel to actually carry information.
test("targetHalfPx: every ticker's own share spread yields distinguishable beads", () => {
  // p25 / p50 / p75 / p90 of the live 2026-08-17 session, per ticker.
  const measured: Record<string, number[]> = {
    SPX: [0.77, 1.26, 2.31, 4.43],
    SPY: [0.65, 1.23, 2.01, 5.03],
    QQQ: [0.51, 0.96, 2.41, 6.09],
    NVDA: [0.05, 0.73, 3.22, 12.11],
    META: [1.01, 1.62, 3.16, 5.58],
    TSLA: [0.67, 1.9, 4.27, 9.52],
  };
  for (const [ticker, pcts] of Object.entries(measured)) {
    const radii = pcts.map((p) => targetHalfPx(p, undefined, Math.max(...pcts), BEAD_TUNING_DEFAULT));
    const distinct = new Set(radii.map((r) => Math.round(r * 2) / 2));
    assert.ok(
      distinct.size >= 3,
      `${ticker}: quartile beads collapsed to ${distinct.size} size(s) — ${radii.map((r) => r.toFixed(2)).join(", ")}`
    );
    assert.ok(
      radii[radii.length - 1] - radii[0] >= 1.5,
      `${ticker}: p25→p90 spread only ${(radii[radii.length - 1] - radii[0]).toFixed(2)}px — reads as one dot`
    );
  }
});

// REGRESSION GUARD (member report 2026-08-16, "all beads look the same size").
//
// #2242 removed the pct proxy so a bead with no recorded notional fell back to the frame-relative
// curve (pct/maxPct)^1.6. Per-strike gamma is heavy-tailed, so that curve collapses the field:
// measured on live data it put 78% (SPX) / 88% (SPY) of beads within 1px of the floor — visually
// one dot. Sizing must stay on a LOG ladder (now the per-ticker SHARE ladder), whose spread
// survives the same tail.
test("targetHalfPx: sizing uses the LOG share ladder, NOT the crushed relative curve", () => {
  // A typical heavy-tail field: one dominant strike, a long thin tail.
  const maxPct = 18.9;
  const median = targetHalfPx(0.61, undefined, maxPct, BEAD_TUNING_DEFAULT);
  const strong = targetHalfPx(6.0, undefined, maxPct, BEAD_TUNING_DEFAULT);
  const king = targetHalfPx(maxPct, undefined, maxPct, BEAD_TUNING_DEFAULT);

  // The three must be TELLABLE APART — at least ~1px between each rung, which is the threshold
  // below which two beads read as the same dot.
  assert.ok(strong - median >= 1, `median ${median.toFixed(2)} vs strong ${strong.toFixed(2)} — under 1px apart`);
  assert.ok(king - strong >= 0.5, `strong ${strong.toFixed(2)} vs king ${king.toFixed(2)} — under 0.5px apart`);
  assert.ok(king <= BEAD_TUNING_DEFAULT.halfMax + 1e-6);
});

test("targetHalfPx: ordering is monotonic in pct when no notional is recorded", () => {
  const maxPct = 20;
  const radii = [0.2, 1, 3, 8, 15, 20].map((p) => targetHalfPx(p, undefined, maxPct, BEAD_TUNING_DEFAULT));
  for (let i = 1; i < radii.length; i++) {
    assert.ok(radii[i] >= radii[i - 1], `radius must not shrink as pct grows: ${radii.join(", ")}`);
  }
});

test("compare bead profile shrinks radius vs default but keeps weak beads legible", () => {
  const compare = beadRenderTuning("compare");
  assert.ok(compare.halfMax < BEAD_TUNING_DEFAULT.halfMax);
  assert.ok(targetHalfPx(50, undefined, 100, compare) < targetHalfPx(50, undefined, 100));
  // Member feedback 2026-08-15: compare beads felt too dim — fill range boosted vs default floor.
  assert.ok(fillAlpha(5, 100, compare) >= 0.55, "weak compare bead stays visible on dark grid");
  assert.ok(
    fillAlpha(5, 100, compare) * (compare.modeledAlphaScale ?? 1) >= 0.35,
    "modeled weak compare bead stays a ghost, not gone"
  );
  assert.ok(fillAlpha(80, 100, compare) >= 0.85, "strong compare bead reads at Thermal contrast");
});

// ── fillAlpha ────────────────────────────────────────────────────────────────

test("fillAlpha: spans [MIN, MAX] and never leaves the band", () => {
  for (const [pct, maxPct] of [[0, 100], [50, 100], [100, 100], [200, 100], [-5, 100], [1, 0]] as const) {
    const a = fillAlpha(pct, maxPct);
    assert.ok(
      a >= FILL_ALPHA_MIN - 1e-9 && a <= FILL_ALPHA_MAX + 1e-9,
      `pct=${pct} max=${maxPct} -> ${a} outside [${FILL_ALPHA_MIN}, ${FILL_ALPHA_MAX}]`
    );
  }
  assert.ok(fillAlpha(100, 100) > fillAlpha(1, 100), "the dominant wall is the most opaque");
});

test("default bead tuning: full strength spread for regular beads, king trimmed only SLIGHTLY", () => {
  const tuning = beadRenderTuning("default");
  // The member asked for the king to stop painting over the candles — "reduce it by a little".
  // #2244/#2247 read that as halo 1.0 -> 0.38 and a 0.72 alpha cap, which flattened the crowned
  // bead into its neighbours and lost the King-node read entirely. The bounds below encode the
  // ACTUAL intent: visibly eased off full strength, still unmistakably the dominant bead.
  const cap = tuning.kingAlphaCap ?? 1;
  assert.ok(cap < 1, "king fill must be eased off full so candles stay visible");
  assert.ok(cap >= 0.85, `king fill must not be gutted — ${cap} is a heavy trim, not a little`);
  assert.ok(tuning.kingBoost >= 0.2, "king size emphasis preserved");
  assert.ok(tuning.kingHaloMul < 1, "king halo eased off full");
  assert.ok(tuning.kingHaloMul >= 0.8, `king halo must stay dominant — ${tuning.kingHaloMul} is a heavy trim`);
  assert.ok(fillAlpha(80, 100, tuning) >= 0.85, "strong regular wall stays bright");
  // REVISED 2026-08-18. This used to assert `>= 0.6`, which pinned the floor of the entire contrast
  // budget at 0.6 and so guaranteed the defect a member then reported from a screenshot: with the
  // range only 0.6 -> 0.98, a heavy wall and a thin one render indistinguishably, and a row shows
  // only that a wall existed, never when it mattered. A weak wall must stay VISIBLE, which is a
  // much lower bar than "almost as bright as a king".
  assert.ok(fillAlpha(3, 100, tuning) >= 0.2, "weak wall stays visible");
  assert.ok(
    fillAlpha(80, 100, tuning) - fillAlpha(3, 100, tuning) >= 0.4,
    "strong vs weak must differ by a spread a viewer can actually SEE"
  );
  assert.ok(
    targetHalfPx(5, undefined, 100, tuning) < targetHalfPx(80, undefined, 100, tuning),
    "size ladder still separates weak vs strong"
  );
});

// ── keys ─────────────────────────────────────────────────────────────────────

test("beadKey: side, strike and bucket are all part of identity", () => {
  assert.notEqual(beadKey("c", 225, 100), beadKey("p", 225, 100), "sides must not collide");
  assert.notEqual(beadKey("c", 225, 100), beadKey("c", 230, 100), "strikes must not collide");
  assert.notEqual(beadKey("c", 225, 100), beadKey("c", 225, 160), "buckets must not collide");
  assert.equal(beadKey("c", 225, 100), beadKey("c", 225, 100), "and it is stable across calls");
});

test("beadKey: no ambiguity between adjacent fields", () => {
  // A separator-free or sloppy join can make (strike 2, time 25) and (strike 22, time 5) the same
  // key, which would silently fuse two beads' easing state.
  assert.notEqual(beadKey("c", 2, 25), beadKey("c", 22, 5));
});

test("kingKey: per-strike and time-independent — the king persists across buckets", () => {
  assert.equal(kingKey("c", 225), kingKey("c", 225));
  assert.notEqual(kingKey("c", 225), kingKey("p", 225));
  assert.notEqual(kingKey("c", 225), kingKey("c", 226));
});

test("kingStrikeByTime: the crown belongs to whoever led AT THAT BUCKET", () => {
  // The member-reported bug: 7760 was emphasised across the whole session because it led at the
  // END. Here 100 leads early and 105 takes over — each bucket must name its own king.
  const trails = [
    { strike: 100, points: [{ time: 1, pct: 40 }, { time: 2, pct: 30 }, { time: 3, pct: 10 }] },
    { strike: 105, points: [{ time: 1, pct: 12 }, { time: 2, pct: 35 }, { time: 3, pct: 60 }] },
  ];
  const kings = kingStrikeByTime(trails);
  assert.equal(kings.get(1), 100, "100 held the crown at t=1");
  assert.equal(kings.get(2), 105, "handover at t=2");
  assert.equal(kings.get(3), 105);
});

test("kingStrikeByTime: a late leader is NOT crowned retroactively", () => {
  // Directly encodes the defect. Under the old per-strike scalar, 105 (the latest leader) would
  // have been emphasised at t=1 too, where it held 1% share.
  const trails = [
    { strike: 100, points: [{ time: 1, pct: 90 }] },
    { strike: 105, points: [{ time: 1, pct: 1 }, { time: 2, pct: 99 }] },
  ];
  const kings = kingStrikeByTime(trails);
  assert.equal(kings.get(1), 100);
  assert.notEqual(kings.get(1), 105, "the eventual king must not wear the crown before it won it");
});

test("kingStrikeByTime: ties are deterministic, not flickering", () => {
  const trails = [
    { strike: 100, points: [{ time: 1, pct: 50 }] },
    { strike: 105, points: [{ time: 1, pct: 50 }] },
  ];
  assert.equal(kingStrikeByTime(trails).get(1), 100, "first encountered wins — stable across repaints");
  assert.equal(kingStrikeByTime(trails).get(1), 100);
});

test("kingStrikeByTime: junk points and strikes are skipped, never crowned", () => {
  const trails = [
    { strike: Number.NaN, points: [{ time: 1, pct: 99 }] },
    { strike: 100, points: [{ time: Number.NaN, pct: 99 }, { time: 1, pct: 5 }, { time: 2, pct: Number.NaN }] },
  ];
  const kings = kingStrikeByTime(trails);
  assert.equal(kings.get(1), 100);
  assert.equal(kings.has(2), false, "a bucket with no usable pct has no king");
});

test("kingStrikeByTime: empty input yields no kings", () => {
  assert.equal(kingStrikeByTime([]).size, 0);
  assert.equal(kingStrikeByTime([{ strike: 100, points: [] }]).size, 0);
});

test("trailingRefs: each point references only STRICTLY EARLIER points", () => {
  const pts = [
    { time: 0, pct: 5 },
    { time: 10, pct: 20 },
    { time: 20, pct: 8 },
    { time: 30, pct: 2 },
  ];
  const refs = trailingRefs(pts, 900);
  // First bead has no past — null, so a wall's BIRTH is never rendered as a fade.
  assert.equal(refs[0], null);
  assert.equal(refs[1], 5, "sees only the 5 before it, NOT its own 20");
  assert.equal(refs[2], 20, "peak so far");
  assert.equal(refs[3], 20, "still measured against the peak while bleeding");
});

test("trailingRefs: the window EXPIRES an old peak so a rebuilt wall isn't judged forever", () => {
  const pts = [
    { time: 0, pct: 50 },      // a big early peak
    { time: 100, pct: 5 },
    { time: 1200, pct: 6 },    // 900s window from here starts at 300 — the peak has aged out
    { time: 2000, pct: 6 },    // nothing at all within 900s of here
  ];
  const refs = trailingRefs(pts, 900);
  assert.equal(refs[1], 50, "inside the window, still measured against the peak");
  assert.equal(refs[2], null, "both earlier points aged out — no baseline in window");
  // A wall with NO point in its trailing window has no baseline, and null renders neutral. That is
  // the intended reading: a wall returning after a long absence is REBORN, not decayed, and judging
  // it against a stale high would paint every re-entry as a dying wall.
  assert.equal(refs[3], 6, "the 1200 bucket is within 900s and becomes the baseline");
});

test("trailingRefs: handles empty, single-point and non-finite pct without throwing", () => {
  assert.deepEqual(trailingRefs([], 900), []);
  assert.deepEqual(trailingRefs([{ time: 0, pct: 3 }], 900), [null]);
  const withNaN = trailingRefs([{ time: 0, pct: NaN }, { time: 10, pct: 4 }], 900);
  assert.equal(withNaN[0], null);
  assert.equal(withNaN[1], null, "a NaN point is never adopted as a baseline");
});

// ── SPACING BUDGET (2026-08-18) ──────────────────────────────────────────────────────────────
// A live screenshot of /vector at 3m showed the rail as painted slabs, not beads: ~5.4px of
// horizontal room per bar against a bead up to 15px wide, so every bead overlapped its neighbours
// ~3x and the rows buried the candles. These pin the budget that stops it.

/** The geometry actually measured off that screenshot: 130 three-minute bars across ~700px, SPX
 *  5-point strikes ~22px apart on the price axis. */
const MEASURED_3M = { barSpacingPx: 5.4, rowGapPx: 22 };

test("at the measured 3m geometry the bead is thinned, but stays READABLE", () => {
  // REVISED 2026-08-18. The first version asserted `diameter <= barSpacing` — no horizontal overlap
  // at all — on the assumption that touching beads were the defect. They are not: in the reference
  // product a row is a near-continuous ribbon of touching dots. Enforcing no-overlap shrank beads to
  // ~3px radius at ordinary zoom and produced a rail of identical faint dots, which a member
  // screenshot caught immediately. Horizontal overlap is TEXTURE; vertical thickness is what buries
  // candles, so the row gap is the constraint that must bind here.
  const t = clampTuningToSpacing(BEAD_TUNING_DEFAULT, MEASURED_3M);
  assert.ok(t.halfMax < BEAD_TUNING_DEFAULT.halfMax, "the slab ceiling must still be reduced");
  assert.ok(t.halfMax >= 3.2, `must stay readable — ${t.halfMax} is the invisible-dot failure`);
  assert.ok(t.halfMax * 2 <= MEASURED_3M.rowGapPx, "rows must not touch vertically");
});

test("a collapsed SIZE RANGE is the failure mode, not just a small bead", () => {
  // Every magnitude mapping to one radius is what makes a row look like a flat dotted line with no
  // history. The range has to survive the clamp, or the size channel is gone even when beads are
  // individually visible.
  const t = clampTuningToSpacing(BEAD_TUNING_DEFAULT, MEASURED_3M);
  assert.ok(
    t.halfMax - t.halfMin >= MIN_CLAMPED_HALF_RANGE_PX,
    `range ${t.halfMin}-${t.halfMax} is too flat to read at 3m`
  );
});

test("rows stay visibly separated — the property the slab render lost", () => {
  // A tight price axis (single-name strikes close together) must shrink beads even when there is
  // plenty of horizontal room, or rows merge vertically instead of horizontally.
  const t = clampTuningToSpacing(BEAD_TUNING_DEFAULT, { barSpacingPx: 60, rowGapPx: 8 });
  assert.ok(t.halfMax * 2 < 8, "a bead must not fill the gap to the next row");
});

test("the FLOOR stays visible on a dense axis — the measured NVDA defect", () => {
  // MEASURED 2026-08-18 on live prod at 1920x1080 (vector-bead-pixel-audit.cjs): NVDA drew 18 beads
  // at a 1.1px MEDIAN radius while SPX drew 160 with a healthy 3x size ratio. The ceiling rule above
  // was working; the floor was not. On a single name the row gap is ~4-12px, so the ceiling clamps
  // to 3.2, and "preserve the ratio" then derived halfMin = 3.2 / 3.4 ≈ 0.94 (raised only to
  // minRadiusPx 1.6). Most walls sit in the weak end of the share distribution, so MOST beads drew
  // at that floor — invisible. Every clamped tuning must now keep its floor at a size a member can
  // actually see.
  for (const rowGapPx of [4, 6, 8, 12, 20]) {
    const t = clampTuningToSpacing(BEAD_TUNING_DEFAULT, { barSpacingPx: 8, rowGapPx });
    assert.ok(
      t.halfMin >= 2,
      `rowGap=${rowGapPx}px collapsed the floor to ${t.halfMin}px — the 1.1px speck failure`
    );
    assert.ok(t.halfMin <= t.halfMax, `rowGap=${rowGapPx}px inverted the range`);
  }
});

test("lifting the floor never flattens the range completely", () => {
  // The floor must not eat the whole ceiling: a rail where every bead is the SAME visible size is
  // the other half of the member's report ("all the beads are same"), and trading one for the other
  // would be no fix at all.
  for (const rowGapPx of [4, 8, 12, 20]) {
    const t = clampTuningToSpacing(BEAD_TUNING_DEFAULT, { barSpacingPx: 8, rowGapPx });
    assert.ok(
      t.halfMax / t.halfMin >= 1.5,
      `rowGap=${rowGapPx}px left only ${(t.halfMax / t.halfMin).toFixed(2)}x of size range`
    );
  }
});

test("the compare profile keeps a visible floor too, without being inflated", () => {
  // Compare panes are deliberately ~55% size; the floor rule must not quietly promote them to the
  // main chart's sizing, only stop them from vanishing.
  const t = clampTuningToSpacing(BEAD_TUNING_COMPARE, { barSpacingPx: 6, rowGapPx: 6 });
  assert.ok(t.halfMin >= 1.5, `compare floor ${t.halfMin}px is below its own profile floor`);
  assert.ok(t.halfMax <= BEAD_TUNING_COMPARE.halfMax, "compare ceiling must never grow");
  assert.ok(t.halfMin <= t.halfMax);
});

test("the budget only ever SHRINKS — a wide zoom keeps the profile's own ceiling", () => {
  // Otherwise this would inflate beads past the size each profile was tuned for, and the Compare
  // pane (deliberately ~55% size) would grow to match the main chart.
  const wide = { barSpacingPx: 400, rowGapPx: 400 };
  assert.equal(clampTuningToSpacing(BEAD_TUNING_DEFAULT, wide), BEAD_TUNING_DEFAULT);
  assert.equal(clampTuningToSpacing(BEAD_TUNING_COMPARE, wide), BEAD_TUNING_COMPARE);
});

test("the size channel survives compression as far as the floor allows", () => {
  // Collapsing halfMax while pinning halfMin would make every bead one size — the exact perceptual
  // failure this fix exists to remove.
  const t = clampTuningToSpacing(BEAD_TUNING_DEFAULT, MEASURED_3M);
  assert.ok(t.halfMin < t.halfMax, "a usable range must remain");
  assert.ok(t.halfMin >= BEAD_TUNING_DEFAULT.minRadiusPx, "beads must stay visible");
});

test("a bead never shrinks below the profile's minimum radius", () => {
  // An absurdly dense axis must not render an invisible rail — better a slightly crowded bead than
  // no bead, since the rail's whole job is showing where the walls are.
  const t = clampTuningToSpacing(BEAD_TUNING_DEFAULT, { barSpacingPx: 0.2, rowGapPx: 0.2 });
  assert.ok(t.halfMax >= BEAD_TUNING_DEFAULT.minRadiusPx);
  assert.ok(t.halfMin >= BEAD_TUNING_DEFAULT.minRadiusPx);
});

test("unusable measurements contribute NO constraint", () => {
  // A missing bar spacing or a single drawn row must degrade to the profile's tuning, not collapse
  // the rail to the floor.
  for (const b of [
    { barSpacingPx: NaN, rowGapPx: Infinity },
    { barSpacingPx: 0, rowGapPx: Infinity },
    { barSpacingPx: -5, rowGapPx: -5 },
  ]) {
    assert.equal(clampTuningToSpacing(BEAD_TUNING_DEFAULT, b), BEAD_TUNING_DEFAULT, JSON.stringify(b));
  }
});

test("closestRowGapPx returns the TIGHTEST pair, and ignores coincident rows", () => {
  assert.equal(closestRowGapPx([100, 140, 152, 300]), 12);
  // Two rows on the same pixel are already indistinguishable; a 0 gap would clamp every bead to the
  // floor on the strength of a rounding coincidence.
  // 100 -> 100.2 is ignored as coincident; the surviving gap is 160 - 100.2.
  assert.equal(closestRowGapPx([100, 100.2, 160]), 59.8);
  assert.equal(closestRowGapPx([100]), Infinity, "one row is unconstrained vertically");
  assert.equal(closestRowGapPx([]), Infinity);
  assert.equal(closestRowGapPx([NaN, 100, 130]), 30);
});

test("the ceiling scales monotonically with available room", () => {
  // Zooming in must never make a bead bigger, and zooming out never smaller — a non-monotonic
  // ceiling would make beads pulse as the user pans.
  let prev = 0;
  for (const spacing of [1, 2, 4, 8, 16, 32, 64]) {
    const t = clampTuningToSpacing(BEAD_TUNING_DEFAULT, { barSpacingPx: spacing, rowGapPx: 400 });
    assert.ok(t.halfMax >= prev, `halfMax shrank going from tighter to wider at ${spacing}`);
    prev = t.halfMax;
  }
});

// ── A ROW MUST READ AS A TIME SERIES OF STRENGTH (2026-08-18, member comparison) ──────────────
// Against the reference product a single row visibly SWELLS and FADES along its length: fat and
// saturated where that wall was heavy, thin and dim where it was not. Ours rendered every bead in
// a row alike, so a row said only THAT a wall existed, never WHEN it mattered. Two separate causes,
// both pinned below: an alpha budget of 0.6-0.98 (a spread nobody can see) and a super-linear alpha
// curve that crushed every non-king row against the floor.

test("THE DEFECT: a mid-strength wall is visibly dimmer than a king, not pinned near it", () => {
  // maxPct is the SESSION-WIDE king, so most rows never approach it. Under the old shared
  // super-linear curve a 30%-of-king wall rendered at 0.66 against a king's 0.87 — a 0.21 spread
  // covering the entire middle of the distribution.
  const king = fillAlpha(100, 100);
  const mid = fillAlpha(30, 100);
  const weak = fillAlpha(3, 100);
  assert.ok(king - mid >= 0.3, `king ${king} vs mid ${mid} — the middle must be readable`);
  assert.ok(mid - weak >= 0.15, `mid ${mid} vs weak ${weak} — weak must read as weak`);
  assert.ok(weak >= 0.2, `weak ${weak} must stay visible, not vanish`);
});

test("the alpha budget is wide enough to be a channel at all", () => {
  // 0.6 -> 0.98 was the whole range: a heavy wall and a thin one rendered indistinguishably.
  assert.ok(
    FILL_ALPHA_MAX - FILL_ALPHA_MIN >= 0.6,
    `an opacity spread of ${FILL_ALPHA_MAX - FILL_ALPHA_MIN} cannot encode strength`
  );
});

test("SIZE and ALPHA use DIFFERENT curves, and each keeps its own job", () => {
  // They shared one exponent, which is why the rail could never have both channels alive: the
  // super-linear shape size needs (a fading wall must visibly shrink) is the same shape that pins
  // alpha to the floor for every row that is not the day's king.
  // NOTE the two channels take DIFFERENT inputs, which is easy to get wrong: targetHalfPx sizes on
  // the ABSOLUTE per-strike share (anchored 0.3%-12%), while fillAlpha is relative to the frame's
  // king. Feeding 90 and 30 to the size ladder saturates both at the ceiling and measures nothing —
  // real shares are single digits.
  const sizeRatio = targetHalfPx(8, undefined, 100) / targetHalfPx(1.5, undefined, 100);
  const alphaGap = fillAlpha(90, 100) - fillAlpha(30, 100);
  assert.ok(sizeRatio > 1.2, `size must still swell with strength (${sizeRatio}x)`);
  assert.ok(alphaGap >= 0.25, `alpha must still separate the same two walls (${alphaGap})`);
});

test("alpha is monotonic — a stronger wall is never dimmer", () => {
  let prev = -1;
  for (const pct of [0.5, 1, 3, 8, 15, 30, 50, 75, 100]) {
    const a = fillAlpha(pct, 100);
    assert.ok(a >= prev, `alpha dipped at ${pct}% (${a} < ${prev})`);
    prev = a;
  }
});

test("a profile may still override the alpha curve explicitly", () => {
  // Compare panes tune their own contrast; the sub-linear default must not silently overrule an
  // explicit contrastExp a profile set for a reason.
  const custom = { ...BEAD_TUNING_DEFAULT, contrastExp: 3 };
  assert.ok(fillAlpha(50, 100, custom) < fillAlpha(50, 100, BEAD_TUNING_DEFAULT));
});

// ── POINT-IN-TIME CONTRAST (2026-08-18) ──────────────────────────────────────────────────────
// The rail knew which strike was king at each bucket (kingStrikeByTime) and used it only to draw a
// crown; strength itself was scaled against the SESSION-WIDE maximum. So a wall that dominated the
// board at 10:15 and was noise by 14:00 rendered at nearly the same brightness in both buckets.

test("THE DEFECT: the same share reads differently in a loud bucket than in a quiet one", () => {
  const trails = [
    { points: [{ time: 100, pct: 30 }, { time: 200, pct: 8 }] }, // the row under test
    { points: [{ time: 100, pct: 40 }, { time: 200, pct: 9 }] }, // the rest of the board
  ];
  const byTime = maxPctByTime(trails);
  assert.equal(byTime.get(100), 40, "bucket 100 was loud");
  assert.equal(byTime.get(200), 9, "bucket 200 was quiet");

  // 8 of a 9-max bucket DOMINATED that moment; 30 of a 40-max bucket did not. Against a single
  // session max (40) the quiet-bucket bead would have been the dimmest thing on the chart.
  const quietBucketAlpha = fillAlpha(8, byTime.get(200));
  const loudBucketAlpha = fillAlpha(30, byTime.get(100));
  const sessionWideAlpha = fillAlpha(8, 40);
  assert.ok(quietBucketAlpha > loudBucketAlpha, "dominating a quiet moment must read as dominant");
  assert.ok(
    quietBucketAlpha - sessionWideAlpha > 0.25,
    "and must be clearly brighter than the session-wide scaling made it"
  );
});

test("SIZE stays absolute while CONTRAST goes relative — the two channels differ on purpose", () => {
  // A huge wall must look huge whenever it happened (comparing across TIME), while brightness says
  // how much it dominated right then (comparing across STRIKES at one moment).
  const bigInLoudBucket = targetHalfPx(9, undefined, 100);
  const smallInQuietBucket = targetHalfPx(2, undefined, 100);
  assert.ok(bigInLoudBucket > smallInQuietBucket, "size must not be re-normalised per bucket");
  assert.ok(
    fillAlpha(2, 2.2) > fillAlpha(9, 40),
    "but the small wall that owned its moment must out-shine the big one that did not"
  );
});

test("maxPctByTime ignores junk and covers both sides of the board", () => {
  const m = maxPctByTime([
    { points: [{ time: 1, pct: 5 }, { time: 1, pct: NaN }, { time: 2, pct: 0 }] },
    { points: [{ time: 1, pct: 12 }, { time: 3, pct: 7 }] },
  ]);
  assert.equal(m.get(1), 12, "max across trails at that bucket");
  assert.equal(m.get(2), undefined, "a non-positive share is not a maximum");
  assert.equal(m.get(3), 7);
});

test("a bucket with no reference falls back to the frame max rather than throwing", () => {
  const m = maxPctByTime([]);
  assert.equal(m.get(999), undefined);
  assert.ok(fillAlpha(5, m.get(999) ?? 20) > 0, "caller's ?? fallback keeps the bead drawable");
});

// ── ROW SWELL (2026-08-19) — competitor-style strength along a strike row ─────────────────────

test("rowPeakRefs: running peak includes the current bucket", () => {
  const peaks = rowPeakRefs([{ pct: 3 }, { pct: 8 }, { pct: 5 }, { pct: 2 }]);
  assert.deepEqual(peaks, [3, 8, 8, 8]);
});

test("rowSwellMul: peak bucket is full weight, faded tail is materially weaker", () => {
  assert.equal(rowSwellMul(10, 10), 1);
  const weak = rowSwellMul(2, 10);
  assert.ok(weak < 0.55, `weak tail ${weak} should read clearly weaker than peak`);
  assert.ok(weak >= ROW_SWELL_FLOOR);
});

test("row swell on targetHalfPx: a 4x pct drop yields at least 2x height ratio on the same row", () => {
  const tuning = BEAD_TUNING_DEFAULT;
  const peak = 12;
  const strong = targetHalfPx(12, undefined, 100, tuning, { rowPeakPct: peak });
  const weak = targetHalfPx(3, undefined, 100, tuning, { rowPeakPct: peak });
  const ratio = strong / weak;
  assert.ok(ratio >= 2, `expected >=2x swell, got ${ratio.toFixed(2)}x (${strong}/${weak})`);
});

test("rowStrengthHaloExtraPx: peak blooms wider than faded tail at measured 3m", () => {
  const barSpacing = 5.4;
  const weak = rowStrengthHaloExtraPx(ROW_SWELL_FLOOR, { barSpacingPx: barSpacing });
  const peak = rowStrengthHaloExtraPx(1, { barSpacingPx: barSpacing });
  assert.ok(peak > weak * 2, `peak ${peak.toFixed(2)} should dominate fade ${weak.toFixed(2)}`);
  assert.ok(peak <= barSpacing * ROW_HALO_BAR_SPACING_FILL + 0.01, "peak halo respects bar budget");
  assert.ok(weak <= peak * 0.35, "faded tail halo is a faint trace, not a second peak");
});

test("rowStrengthHaloExtraPx: zoomed-out session gets a larger peak corona", () => {
  const densePeak = rowStrengthHaloExtraPx(1, { barSpacingPx: 5.4 });
  const widePeak = rowStrengthHaloExtraPx(1, { barSpacingPx: 60 });
  assert.ok(widePeak > densePeak, "wider bars → bigger bloom at peak");
});

test("beadCenterSpacingPx: scales with bar width and interval", () => {
  assert.ok(Math.abs(beadCenterSpacingPx(5.4, 180) - 0.15) < 0.02);
  assert.ok(beadCenterSpacingPx(60, 180) > beadCenterSpacingPx(5.4, 180));
});

test("rowStrengthHaloAlphaMul: peak is bright, fade is a faint trace", () => {
  assert.ok(rowStrengthHaloAlphaMul(1) > rowStrengthHaloAlphaMul(ROW_SWELL_FLOOR) * 2);
});


// ── ROW SWELL AT MEASURED GEOMETRY (2026-08-19) ───────────────────────────────────────────────
// These assert against the REAL spacing budget (3m bar ~5.4px, ~8px between strike rows on a dense
// single name), not against hand-written tuning values. The first version of the range guard passed
// a synthetic-tuning test while doing nothing at all at this geometry — the numbers were right in
// the test and wrong on the desk.
const DENSE = { barSpacingPx: 5.4, rowGapPx: 8 };

test("clamped range meets its target at the geometry the guard was written for", () => {
  const t = clampTuningToSpacing(beadRenderTuning("default"), DENSE);
  assert.ok(
    beadRangeMeetsTarget(t),
    `range ${(t.halfMax - t.halfMin).toFixed(2)}px < target ${MIN_CLAMPED_HALF_RANGE_PX}px — the ` +
      "guard is not binding at 3m, which is exactly the case it exists for"
  );
});

test("row swell never pushes a bead below the READABLE floor", () => {
  // minRadiusPx (1.6) is "still technically drawn"; BEAD_VISIBLE_MIN_HALF_PX (2.0) is the floor
  // measured against a member's eyes. A swelled fade must not walk back through it — that is the
  // 1.1px-speck regression the floor was introduced to end.
  const t = clampTuningToSpacing(beadRenderTuning("default"), DENSE);
  for (const pct of [8, 4, 2, 1, 0.5, 0.1]) {
    const half = targetHalfPx(pct, 8, undefined, t, { rowPeakPct: 8 });
    assert.ok(
      half >= Math.min(t.halfMax, BEAD_VISIBLE_MIN_HALF_PX) - 1e-9,
      `pct ${pct} rendered at ${half.toFixed(2)}px — below the readable floor`
    );
  }
});

test("row swell is non-increasing, and differentiates until the floor binds", () => {
  // Two properties, deliberately separate. A fade must never render LARGER than the moment before
  // it (monotonicity), and it must actually differentiate while there is range to spend. Below the
  // floor the radius channel is exhausted — asserted rather than hidden, because that is the real
  // limit at dense zoom and the reason a second channel is needed down there.
  const t = clampTuningToSpacing(beadRenderTuning("default"), DENSE);
  const pcts = [8, 4, 2, 1, 0.5];
  const halves = pcts.map((pct) => targetHalfPx(pct, 8, undefined, t, { rowPeakPct: 8 }));
  for (let i = 1; i < halves.length; i++) {
    assert.ok(
      halves[i]! <= halves[i - 1]! + 1e-9,
      `fade must never grow: ${halves.map((h) => h.toFixed(2)).join(" / ")}`
    );
  }
  const floorPx = Math.min(t.halfMax, BEAD_VISIBLE_MIN_HALF_PX);
  const aboveFloor = halves.filter((h) => h > floorPx + 1e-6);
  assert.ok(aboveFloor.length >= 2, "the swell must differentiate somewhere on the row");
  for (let i = 1; i < aboveFloor.length; i++) {
    assert.ok(aboveFloor[i]! < aboveFloor[i - 1]! - 1e-6, "distinct while above the floor");
  }
});

test("row swell is a no-op at the row peak, and absent without a peak", () => {
  const t = clampTuningToSpacing(beadRenderTuning("default"), DENSE);
  const atPeak = targetHalfPx(8, 8, undefined, t, { rowPeakPct: 8 });
  const noSwell = targetHalfPx(8, 8, undefined, t);
  assert.ok(Math.abs(atPeak - noSwell) < 1e-9, "the strongest bead on a row is unchanged by swell");
  for (const bad of [null, undefined, 0, -1, Number.NaN]) {
    assert.equal(
      targetHalfPx(2, 8, undefined, t, { rowPeakPct: bad as number }),
      targetHalfPx(2, 8, undefined, t),
      `rowPeakPct=${String(bad)} must leave sizing untouched, not scale by a floor`
    );
  }
});

test("rowSwellMul: bounded, monotonic, and floored", () => {
  assert.equal(rowSwellMul(8, 8), 1, "at the peak");
  assert.ok(rowSwellMul(4, 8) < rowSwellMul(8, 8));
  assert.ok(rowSwellMul(1, 8) < rowSwellMul(4, 8));
  for (const [pct, peak] of [[0, 8], [-1, 8], [2, 0], [Number.NaN, 8]] as const) {
    const m = rowSwellMul(pct, peak);
    assert.ok(m > 0 && m <= 1, `unusable input (${pct}, ${peak}) gave ${m}`);
  }
});

// ── THE HALO IS DRAWN IN TWO AXES AND WAS BUDGETED IN ONE (2026-08-19) ─────────────────────────
// Member report during live RTH, with the strongest SPX rows circled: "dont you think it paints
// too hard like too thick for the strong nodes".
//
// The core bead obeys BEAD_ROW_FILL (0.55 of the row gap). The strength halo is added ON TOP of the
// core and was capped only against BAR SPACING — a horizontal measure — so vertically it was
// unbounded. Measured on prod: band thickness / nearest row gap ran a median p90 of 0.64 and
// exceeded 1.0 on 15 of 21 frames, worst 1.58 on QQQ. Above 1.0 the bead is thicker than the space
// to its neighbour, so rows touch and the candles behind them disappear.
//
// Model-side tests could not have caught this: each function was individually correct, and the
// defect lived in the SUM of two independently-budgeted radii. Hence a test on the sum.
test("strength halo is budgeted against the ROW GAP, not just bar spacing", () => {
  // Wide bars, tight rows — the geometry where the bar-spacing cap alone leaves the halo free.
  const wideBars = { barSpacingPx: 40, rowGapPx: 10 };
  const atPeak = rowStrengthHaloExtraPx(1, wideBars);
  assert.ok(
    atPeak <= (wideBars.rowGapPx * ROW_HALO_ROW_GAP_FILL) / 2 + 1e-9,
    `halo ${atPeak}px must fit the row-gap budget, got more than ${(wideBars.rowGapPx * ROW_HALO_ROW_GAP_FILL) / 2}px`
  );
  // Without the row gap the same swell is allowed to bloom much further — which is the old bug.
  const unbudgeted = rowStrengthHaloExtraPx(1, { barSpacingPx: 40 });
  assert.ok(unbudgeted > atPeak, "the row-gap budget must actually bind on this geometry");
});

// Asserts against the BUDGET, not against 1.0 — adopted from Cursor's #2339, which is the
// stronger form. `<= 1.0` only catches rows literally overlapping, which is the symptom at its
// very worst; it would pass happily at 0.95 while the rail reads as a slab to anyone looking at
// it. Tying the assertion to ROW_HALO_ROW_GAP_FILL means the test fails the moment the drawn
// band exceeds what the budget promised, whatever that budget is later retuned to.
test("core + halo together stay inside the row-gap budget, leaving air between rows", () => {
  // The ordering invariant first. An earlier attempt set the core budget ABOVE the combined
  // core+halo budget, so the core alone busted it and the halo was squeezed to its 0.25px minimum
  // on every row — a silent flattening of the exact channel this all exists to produce. The weak
  // `<= 1.0` form of this test passed straight through it.
  assert.ok(
    BEAD_ROW_FILL_FOR_TEST <= ROW_HALO_ROW_GAP_FILL,
    `core budget ${BEAD_ROW_FILL_FOR_TEST} must not exceed the combined budget ${ROW_HALO_ROW_GAP_FILL}`
  );
  for (const rowGapPx of [8, 12, 20, 30, 44]) {
    const halfMax = (rowGapPx * BEAD_ROW_FILL_FOR_TEST) / 2;
    const halo = rowStrengthHaloExtraPx(1, { barSpacingPx: 60, rowGapPx, coreHalfPx: halfMax });
    const thickness = 2 * (halfMax + halo);
    assert.ok(
      thickness / rowGapPx <= ROW_HALO_ROW_GAP_FILL + 1e-9,
      `rowGap=${rowGapPx}: core+halo fills ${(thickness / rowGapPx).toFixed(2)} of the slot, over the ${ROW_HALO_ROW_GAP_FILL} budget`
    );
  }
});

test("the halo still grows with strength — the budget is a ceiling, not a flattening", () => {
  const geom = { barSpacingPx: 40, rowGapPx: 20 };
  const weak = rowStrengthHaloExtraPx(0.2, geom);
  const mid = rowStrengthHaloExtraPx(0.6, geom);
  const peak = rowStrengthHaloExtraPx(1, geom);
  assert.ok(weak < mid && mid < peak, "clamping the peak must not collapse the swell into one size");
});

// ── COLOUR: WEAK BEADS ARE PALER, NOT JUST DIMMER (2026-08-19) ─────────────────────────────────
// Member spec: "Weak beads -> paler, muted yellow/magenta ... Strong beads -> full saturated
// #ffd60a / #d97bff". Alpha alone could not deliver that once the rail moved BEHIND the candles:
// a low-alpha bead reads as whatever is behind it, not as a muted shade of its own hue.
test("wallBeadColorShade: peak strength is the untouched brand hue", () => {
  assert.equal(wallBeadColorShade("#ffd60a", 1), "#ffd60a");
  assert.equal(wallBeadColorShade("#d97bff", 1), "#d97bff");
});

test("wallBeadColorShade: weak beads mute toward the desk ground, monotonically", () => {
  const lum = (hex: string) =>
    parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
  for (const base of ["#ffd60a", "#d97bff"]) {
    const shades = [0.05, 0.25, 0.5, 0.75, 1].map((t) => lum(wallBeadColorShade(base, t)));
    for (let i = 1; i < shades.length; i++) {
      assert.ok(shades[i]! >= shades[i - 1]!, `${base}: shade must not darken as strength rises`);
    }
    // And the range has to be worth having — a 5%-of-book bead must be obviously paler than a peak.
    assert.ok(shades[0]! < shades[shades.length - 1]! * 0.6, `${base}: weak/strong shades too close to tell apart`);
  }
});

test("wallBeadColorShade: the SIDE hue survives at every strength", () => {
  // Yellow stays red+green dominant, magenta stays red+blue dominant — a shade that inverted this
  // would make a call wall read as a put wall, which is worse than no colour channel at all.
  for (const t of [0.05, 0.3, 0.7, 1]) {
    const y = wallBeadColorShade("#ffd60a", t);
    const m = wallBeadColorShade("#d97bff", t);
    const [yr, yg, yb] = [1, 3, 5].map((i) => parseInt(y.slice(i, i + 2), 16));
    const [mr, mg, mb] = [1, 3, 5].map((i) => parseInt(m.slice(i, i + 2), 16));
    assert.ok(yg > yb, `call shade at t=${t} lost its yellow`);
    assert.ok(mb > mg, `put shade at t=${t} lost its magenta`);
    assert.ok(yr > 0 && mr > 0);
  }
});

test("wallBeadColorShade: malformed input passes through rather than painting NaN", () => {
  // Canvas treats an unparseable fillStyle as a no-op and keeps the PREVIOUS colour, so a bad
  // shade would silently paint beads in the wrong side's hue.
  for (const bad of ["", "#fff", "rgb(1,2,3)", "#gggggg", "not-a-colour"]) {
    assert.equal(wallBeadColorShade(bad, 0.4), bad);
  }
  assert.equal(wallBeadColorShade("#ffd60a", Number.NaN), wallBeadColorShade("#ffd60a", 0));
});
